#!/usr/bin/env python3
"""把逐小节的文本转写编译成 MusicXML（自动连梁、延音线、连音符、多声部、时值校验）。

用法:
  python build_musicxml.py transcription.txt -o "src/assets/<合集>/<曲名>.musicxml"

转写格式见 SKILL.md 与 examples/syntax.txt。
"""
import argparse
import re
import shutil
import subprocess
import sys
from xml.sax.saxutils import escape

DIV = 24  # divisions per quarter: 32nd notes and triplets stay integral
DURS = {"32": (3, "32nd", 0), "16": (6, "16th", 0), "16.": (9, "16th", 1), "8": (12, "eighth", 0),
        "8.": (18, "eighth", 1), "8..": (21, "eighth", 2), "4": (24, "quarter", 0), "4.": (36, "quarter", 1),
        "4..": (42, "quarter", 2), "2": (48, "half", 0), "2.": (72, "half", 1), "1": (96, "whole", 0),
        "1.": (144, "whole", 1)}
BEAM_LEVELS = {"eighth": 1, "16th": 2, "32nd": 3}
ALTER = {"": None, "#": 1, "##": 2, "b": -1, "bb": -2, "n": 0}
ACC_NAME = {1: "sharp", 2: "double-sharp", -1: "flat", -2: "flat-flat", 0: "natural"}
SHARP_ORDER, FLAT_ORDER = "FCGDAEB", "BEADGCF"
DYNAMICS = {"ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "sf", "sfz", "fp"}
CLEF_SIGN = {"G": ("G", 2, 0), "F": ("F", 4, 0), "C": ("C", 3, 0), "G8": ("G", 2, -1)}
PITCH_RE = r"[A-G](?:##|#|bb|b|n)?\d"
TOKEN = re.compile(rf"^(g)?(\()?(r|{PITCH_RE}(?:\+{PITCH_RE})*):?(32|16\.?|8\.{{0,2}}|4\.{{0,2}}|2\.?|1\.?)"
                   r"(?:/(\d))?((?:[~!=)]|\"[^\"]*\")*)$")
PITCH = re.compile(r"^([A-G])(##|#|bb|b|n)?(\d)$")


class TranscriptionError(Exception):
    pass


def key_alters(fifths):
    order = SHARP_ORDER if fifths > 0 else FLAT_ORDER
    return {s: (1 if fifths > 0 else -1) for s in order[:abs(fifths)]}


def parse_events(text, where):
    events = []
    for tok in text.split():
        m = TOKEN.match(tok)
        if not m:
            raise TranscriptionError(f"{where}: 无法解析 `{tok}`")
        grace, slur_start, pitches, dur, tuplet, suffix = m.groups()
        divs, typ, dots = DURS[dur]
        actual = int(tuplet) if tuplet else None
        normal = None
        if actual:
            normal = 1 << (actual.bit_length() - 1)
            if normal == actual or (divs * normal) % actual:
                raise TranscriptionError(f"{where}: `{tok}` 不支持的连音（仅支持 /3 /6 等可整除的连音）")
            divs = divs * normal // actual
        notes = []
        if pitches != "r":
            for p in pitches.split("+"):
                step, acc, octave = PITCH.match(p).groups()
                notes.append((step, acc or "", int(octave)))
        lyric = re.search(r'"([^"]*)"', suffix)
        flags = re.sub(r'"[^"]*"', "", suffix)
        events.append({"grace": bool(grace), "rest": pitches == "r", "notes": notes, "divs": divs, "type": typ,
                       "dots": dots, "tie": "~" in flags, "fermata": "!" in flags, "join": "=" in flags,
                       "slur_start": bool(slur_start), "slur_stop": ")" in flags,
                       "lyric": lyric.group(1).replace("_", " ") if lyric else None,
                       "tuplet": (actual, normal) if actual else None})
    return events


def assign_tuplets(events, where):
    run, total, target = [], 0, 0
    for e in events:
        if not e["tuplet"]:
            if run:
                raise TranscriptionError(f"{where}: 连音组不完整")
            continue
        if not run:
            actual, normal = e["tuplet"]
            target = e["divs"] * actual // normal * normal
        run.append(e)
        total += e["divs"]
        if total == target:
            run[0]["tuplet_mark"] = "start"
            run[-1]["tuplet_mark"] = "stop" if len(run) > 1 else "start stop"
            run, total = [], 0
        elif total > target:
            raise TranscriptionError(f"{where}: 连音组时值超出")
    if run:
        raise TranscriptionError(f"{where}: 连音组不完整")


def assign_beams(events, beat):
    pos, group, groups = 0, [], []
    for e in events:
        if e["grace"]:
            continue
        beamable = not e["rest"] and e["type"] in BEAM_LEVELS
        joined = group and group[-1][0]["join"]
        if group and (not beamable or (pos // beat != group[0][1] // beat and not joined)):
            groups.append(group)
            group = []
        if beamable:
            group.append((e, pos))
        pos += e["divs"]
    if group:
        groups.append(group)
    for g in groups:
        if len(g) < 2:
            continue
        notes = [e for e, _ in g]
        for i, e in enumerate(notes):
            beams = [(1, "begin" if i == 0 else "end" if i == len(notes) - 1 else "continue")]
            for level in (2, 3):
                if BEAM_LEVELS[e["type"]] < level:
                    continue
                prev = i > 0 and BEAM_LEVELS[notes[i - 1]["type"]] >= level
                nxt = i < len(notes) - 1 and BEAM_LEVELS[notes[i + 1]["type"]] >= level
                if prev and nxt:
                    beams.append((level, "continue"))
                elif nxt:
                    beams.append((level, "begin"))
                elif prev:
                    beams.append((level, "end"))
                else:
                    beams.append((level, "forward hook" if i < len(notes) - 1 else "backward hook"))
            e["beams"] = beams
    graces = [e for e in events if e["grace"] and e["type"] in BEAM_LEVELS]
    if len(graces) >= 2:
        for i, e in enumerate(graces):
            e["beams"] = [(1, "begin" if i == 0 else "end" if i == len(graces) - 1 else "continue")]


def note_xml(e, note, chord, staff, voice, stem, key, measure_acc, octave_shift, ties, lyric_state):
    out = ["<note>"]
    if e["grace"]:
        out.append('<grace slash="yes"/>' if e["type"] == "eighth" else "<grace/>")
    if chord:
        out.append("<chord/>")
    tie_types = []
    if e["rest"]:
        out.append("<rest/>")
    else:
        step, acc, octave = note
        octave += octave_shift
        written = ALTER[acc]
        alter = written if written is not None else measure_acc.get((step, octave), key.get(step, 0))
        if written is not None:
            measure_acc[(step, octave)] = written
        out.append(f"<pitch><step>{step}</step>" + (f"<alter>{alter}</alter>" if alter else "")
                   + f"<octave>{octave}</octave></pitch>")
        pid = (staff, voice, step, alter, octave)
        if pid in ties:
            tie_types.append("stop")
            ties.discard(pid)
        if e["tie"]:
            tie_types.append("start")
            ties.add(pid)
    if not e["grace"]:
        out.append(f"<duration>{e['divs']}</duration>")
    out += [f'<tie type="{t}"/>' for t in tie_types]
    out.append(f"<voice>{voice}</voice><type>{e['type']}</type>" + "<dot/>" * e["dots"])
    if not e["rest"] and ALTER[note[1]] is not None:
        out.append(f"<accidental>{ACC_NAME[ALTER[note[1]]]}</accidental>")
    if e["tuplet"]:
        out.append(f"<time-modification><actual-notes>{e['tuplet'][0]}</actual-notes>"
                   f"<normal-notes>{e['tuplet'][1]}</normal-notes></time-modification>")
    if stem and not e["rest"]:
        out.append(f"<stem>{stem}</stem>")
    out.append(f"<staff>{staff}</staff>")
    if not chord:
        out += [f'<beam number="{n}">{v}</beam>' for n, v in e.get("beams", [])]
    notations = [f'<tied type="{t}"/>' for t in tie_types]
    if not chord:
        if e["slur_start"]:
            notations.append('<slur type="start" number="1"/>')
        if e["slur_stop"]:
            notations.append('<slur type="stop" number="1"/>')
        for mark in e.get("tuplet_mark", "").split():
            notations.append(f'<tuplet type="{mark}" bracket="yes"/>')
        if e["fermata"]:
            notations.append('<fermata type="upright"/>')
    if notations:
        out.append("<notations>" + "".join(notations) + "</notations>")
    if not chord and e["lyric"]:
        text = e["lyric"]
        cont = text.endswith("-")
        text = text.rstrip("-")
        prev = lyric_state.get(voice, False)
        syllabic = ("middle" if cont else "end") if prev else ("begin" if cont else "single")
        lyric_state[voice] = cont
        out.append(f'<lyric number="1"><syllabic>{syllabic}</syllabic><text>{escape(text)}</text></lyric>')
    out.append("</note>")
    return "".join(out)


def direction(body, staff=1, placement="below", offset=0):
    off = f"<offset>{offset}</offset>" if offset else ""
    return (f'<direction placement="{placement}"><direction-type>{body}</direction-type>'
            f"{off}<staff>{staff}</staff></direction>")


def parse_file(path):
    meta = {"title": "Untitled", "composer": "", "lyricist": "", "fifths": "0", "time": "4/4", "clefs": "G F",
            "tempo": "", "instrument": "Piano"}
    macros, measures = {}, []
    for lineno, raw in enumerate(open(path, encoding="utf-8"), 1):
        line = re.sub(r"\s*//.*$", "", raw).rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if m := re.match(r"^let\s+(\w+)\s*=\s*(.*)$", line):
            macros[m.group(1)] = m.group(2).strip()
        elif m := re.match(r"^(\w+)\s*:\s*(.*)$", line):
            meta[m.group(1)] = m.group(2).strip()
        elif m := re.match(r"^(\d+)\s*\|(.*)$", line):
            parts = [p.strip() for p in m.group(2).split("|")]
            for _ in range(3):
                parts = [re.sub(r"\$(\w+)", lambda mm: macros[mm.group(1)], p) for p in parts]
            measures.append((int(m.group(1)), parts))
        else:
            raise TranscriptionError(f"第 {lineno} 行无法识别: {raw.rstrip()}")
    return meta, measures


def time_info(sig):
    beats, beat_type = map(int, sig.split("/"))
    measure = beats * DIV * 4 // beat_type
    beat = DIV * 4 // beat_type * (3 if beat_type == 8 and beats % 3 == 0 and beats > 3 else 1)
    return beats, beat_type, measure, beat


def clef_xml(number, clef):
    sign, line, octave = CLEF_SIGN[clef]
    change = f"<clef-octave-change>{octave}</clef-octave-change>" if octave else ""
    return f'<clef number="{number}"><sign>{sign}</sign><line>{line}</line>{change}</clef>'


def build(path):
    meta, measures = parse_file(path)
    fifths = int(meta["fifths"])
    beats, beat_type, measure_divs, beat = time_info(meta["time"])
    clefs = meta["clefs"].split()
    nstaves = len(clefs)
    key = key_alters(fifths)
    ties, lyric_state, shift, errors, parts_xml = set(), {}, 0, [], []
    pending_shift_stop = False

    for idx, (num, parts) in enumerate(measures):
        staves_txt = parts[:nstaves]
        marks = parts[nstaves].split() if len(parts) > nstaves else []
        if len(staves_txt) < nstaves:
            raise TranscriptionError(f"第 {num} 小节只有 {len(staves_txt)} 个谱表，应为 {nstaves}")
        pickup = "pickup" in marks
        x = [f'<measure number="{num}"' + (' implicit="yes"' if pickup else "") + ">"]
        if "page" in marks:
            x.append('<print new-page="yes"/>')
        elif "system" in marks:
            x.append('<print new-system="yes"/>')
        left = []
        if "repeat-start" in marks:
            left.append('<repeat direction="forward"/>')
        for n in "123":
            if f"ending{n}-start" in marks:
                left.append(f'<ending number="{n}" type="start">{n}.</ending>')
        if left:
            x.append('<barline location="left">' + ("<bar-style>heavy-light</bar-style>" if "repeat-start" in marks else "")
                     + "".join(left) + "</barline>")

        attrs = []
        changes = dict(mk.split("=", 1) for mk in marks if re.match(r"^(key|time|clef\d)=", mk))
        if idx == 0 or "key" in changes:
            if "key" in changes:
                fifths = int(changes["key"])
                key = key_alters(fifths)
            attrs.append(f"<key><fifths>{fifths}</fifths></key>")
        if idx == 0 or "time" in changes:
            if "time" in changes:
                beats, beat_type, measure_divs, beat = time_info(changes["time"])
            attrs.append(f"<time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>")
        if idx == 0:
            attrs.append(f"<staves>{nstaves}</staves>" if nstaves > 1 else "")
            attrs += [clef_xml(i + 1, c) for i, c in enumerate(clefs)]
        else:
            attrs += [clef_xml(int(k[4:]), v) for k, v in changes.items() if k.startswith("clef")]
        if attrs:
            x.append("<attributes>" + (f"<divisions>{DIV}</divisions>" if idx == 0 else "") + "".join(attrs) + "</attributes>")
        if idx == 0 and meta["tempo"]:
            x.append(direction(f"<metronome><beat-unit>quarter</beat-unit><per-minute>{meta['tempo']}"
                               "</per-minute></metronome>", placement="above"))

        for mk in marks:
            name, _, off = mk.partition("@")
            offset = int(off) * DIV // 4 if off else 0
            if name in DYNAMICS:
                x.append(direction(f"<dynamics><{name}/></dynamics>", offset=offset))
            elif name in ("cresc", "dim"):
                x.append(direction(f"<words>{name}.</words>", offset=offset))
            elif name in ("<", ">"):
                x.append(direction(f'<wedge type="{"crescendo" if name == "<" else "diminuendo"}"/>', offset=offset))
            elif name == "wedge-stop":
                x.append(direction('<wedge type="stop"/>', offset=offset))
            elif name in ("8va", "15ma", "8vb"):
                size = 15 if name == "15ma" else 8
                shift = {"8va": 1, "15ma": 2, "8vb": -1}[name]
                x.append(direction(f'<octave-shift type="{"down" if shift > 0 else "up"}" size="{size}"/>',
                                   placement="above" if shift > 0 else "below"))
            elif name.startswith("text="):
                x.append(direction(f"<words>{escape(name[5:].replace('_', ' '))}</words>", placement="above"))
        if any(m in marks for m in ("8va-end", "15ma-end", "8vb-end")):
            pending_shift_stop = True

        voices = []
        for si, txt in enumerate(staves_txt, 1):
            texts = [t.strip() for t in txt.split("&")]
            for vi, vtxt in enumerate(texts, 1):
                voices.append((si, (si - 1) * 4 + vi, ("up" if vi == 1 else "down") if len(texts) > 1 else None, vtxt))
        measure_acc = {si: {} for si in range(1, nstaves + 1)}
        for i, (si, voice, stem, vtxt) in enumerate(voices):
            where = f"第 {num} 小节 staff{si} voice{voice}"
            events = parse_events(vtxt, where)
            used = sum(e["divs"] for e in events if not e["grace"])
            if not pickup and used != measure_divs:
                errors.append(f"{where}: 时值 {used / DIV:g} 拍，应为 {measure_divs / DIV:g} 拍")
            assign_tuplets(events, where)
            assign_beams(events, beat)
            for e in events:
                staff_shift = shift if si == 1 else 0
                for ni, note in enumerate(e["notes"] or [None]):
                    x.append(note_xml(e, note, ni > 0, si, voice, stem, key, measure_acc[si], staff_shift,
                                      ties, lyric_state))
            if i < len(voices) - 1 and used:
                x.append(f"<backup><duration>{used}</duration></backup>")
        if pending_shift_stop:
            x.append(direction(f'<octave-shift type="stop" size="{15 if abs(shift) == 2 else 8}"/>',
                               placement="above" if shift > 0 else "below"))
            shift, pending_shift_stop = 0, False

        right = []
        last = idx == len(measures) - 1
        for n in "123":
            if f"ending{n}-stop" in marks:
                right.append(f'<ending number="{n}" type="stop"/>')
            if f"ending{n}-open" in marks:
                right.append(f'<ending number="{n}" type="discontinue"/>')
        style = "light-heavy" if ("repeat-end" in marks or last or "final" in marks) else ("light-light" if "double" in marks else "")
        if "repeat-end" in marks:
            right.append('<repeat direction="backward"/>')
        if style or right:
            x.append('<barline location="right">' + (f"<bar-style>{style}</bar-style>" if style else "")
                     + "".join(right) + "</barline>")
        x.append("</measure>")
        parts_xml.append("\n".join(x))

    if errors:
        raise TranscriptionError("时值校验失败:\n  " + "\n  ".join(errors))
    if ties:
        print(f"警告: 有延音线未闭合: {sorted(ties)}", file=sys.stderr)
    creators = "".join(f'<creator type="{t}">{escape(meta[t])}</creator>' for t in ("composer", "lyricist") if meta[t])
    return ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
            '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
            '"http://www.musicxml.org/dtds/partwise.dtd">\n'
            f'<score-partwise version="4.0"><work><work-title>{escape(meta["title"])}</work-title></work>'
            + (f"<identification>{creators}</identification>" if creators else "")
            + f'<part-list><score-part id="P1"><part-name>{escape(meta["instrument"])}'
            '</part-name></score-part></part-list><part id="P1">\n' + "\n".join(parts_xml) + "\n</part></score-partwise>\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("transcription")
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args()
    try:
        xml = build(args.transcription)
    except TranscriptionError as err:
        sys.exit(f"错误: {err}")
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(xml)
    print(f"已生成 {args.out}: {xml.count('<measure ')} 小节, {xml.count('<note>')} 个音符")
    if shutil.which("xmllint"):
        r = subprocess.run(["xmllint", "--noout", args.out], capture_output=True, text=True)
        print("xmllint: OK" if r.returncode == 0 else f"xmllint 报错:\n{r.stderr}")


if __name__ == "__main__":
    main()
