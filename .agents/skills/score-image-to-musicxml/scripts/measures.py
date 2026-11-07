#!/usr/bin/env python3
"""定位谱表与小节线，输出带音高刻度的逐小节放大图、符头音高猜测和版面信息。

用法:
  python measures.py page1.png page2.png ... -o work/ [--staves-per-system 2] [--clefs G,F]
                     [--add-bar 页:行:x ...] [--drop-bar 页:行:x ...]

输出:
  work/overview/pN.png 整页总览：红框=检测到的小节线，蓝字=小节号，先看它核对分段
  work/pages/pN.png    预处理（去透明、去底色、纠斜）后的页面，ascii.py 读这里
  work/crops/mNN.png   每小节放大图，左侧标注每个线/间对应的音名（红色=五线）
  work/heads.txt       每小节符头的 x 坐标与音高猜测，o 后缀=空心符头（二分/全音符）
  work/layout.json     供 ascii.py 使用的版面信息
"""
import argparse
import json
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

STEPS = "CDEFGAB"
CLEF_TOP_LINE = {"G": ("F", 5), "F": ("A", 3), "C": ("G", 4), "G8": ("F", 4)}
INK = 160


def pitch_name(clef, steps_above_top):
    step, octave = CLEF_TOP_LINE[clef]
    i = STEPS.index(step) + octave * 7 + steps_above_top
    return f"{STEPS[i % 7]}{i // 7}"


def flat(img):
    return list(img.get_flattened_data() if hasattr(img, "get_flattened_data") else img.getdata())


def odd(v):
    return max(3, int(round(v)) | 1)


def load_page(path):
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info:
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, "white")
        bg.alpha_composite(im)
        im = bg
    gray = im.convert("L")
    small = gray.resize((max(1, gray.width // 8), max(1, gray.height // 8)), Image.Resampling.BOX)
    background = small.filter(ImageFilter.MaxFilter(7)).resize(gray.size, Image.Resampling.BILINEAR)
    gray = ImageOps.autocontrast(ImageOps.invert(ImageChops.subtract(background, gray)), cutoff=0.5)
    return deskew(gray)


def deskew(gray):
    scale = 800 / gray.width
    ink = ImageOps.invert(gray.resize((800, max(1, int(gray.height * scale)))))
    best, best_angle = -1, 0.0
    for tenth in range(-30, 31):
        rows = ink.rotate(tenth / 10, resample=Image.Resampling.BILINEAR).resize((1, ink.height), Image.Resampling.BOX)
        score = sum(v * v for v in flat(rows))
        if score > best:
            best, best_angle = score, tenth / 10
    if best_angle:
        gray = gray.rotate(best_angle, resample=Image.Resampling.BICUBIC, fillcolor=255)
    return gray, best_angle


def find_staves(gray):
    w, h = gray.size
    x0, x1 = int(w * 0.1), int(w * 0.9)
    band = gray.crop((x0, 0, x1, h)).point(lambda v: 255 if v < 200 else 0).resize((1, h), Image.Resampling.BOX)
    coverage = flat(band)
    groups = []
    for y, v in enumerate(coverage):
        if v <= 255 * 0.5:
            continue
        if groups and y - groups[-1][-1] <= 2:
            groups[-1].append(y)
        else:
            groups.append([y])
    lines = [(sum(g) / len(g), max(coverage[y] for y in g)) for g in groups]
    windows = []
    for i in range(len(lines) - 4):
        seg = [y for y, _ in lines[i:i + 5]]
        gaps = [seg[j + 1] - seg[j] for j in range(4)]
        if min(gaps) >= 3 and max(gaps) - min(gaps) <= max(1.5, 0.15 * sum(gaps) / 4):
            windows.append((min(c for _, c in lines[i:i + 5]), i, seg))
    staves, used = [], set()
    for _, i, seg in sorted(windows, reverse=True):
        if used.isdisjoint(range(i, i + 5)):
            used.update(range(i, i + 5))
            staves.append(seg)
    return sorted(staves)


def find_barlines(gray, system, space, heads):
    w, _ = gray.size
    px = gray.load()
    top, bottom = int(round(system[0][0])), int(round(system[-1][4]))
    band = gray.crop((0, top, w, bottom + 1)).point(lambda v: 255 if v < INK else 0)
    coverage = flat(band.resize((w, 1), Image.Resampling.BOX))
    line_rows = {int(round(y)) + d for staff in system for y in staff for d in (-1, 0, 1)}
    inner = [y for y in range(top, bottom + 1) if y not in line_rows]
    reach = max(3, int(space * 0.4))
    above = range(int(system[0][0]) - reach, int(system[0][0]) - 1)
    below = range(int(system[-1][4]) + 3, int(system[-1][4]) + reach + 2)

    def dark(x, rows):
        rows = [y for y in rows if 0 <= y < gray.height]
        return sum(px[x, y] < INK for y in rows) / max(1, len(rows)) if 0 <= x < w else 0

    top_end = range(int(system[0][0]) + 1, int(system[0][0] + space * 0.6) + 1)
    bottom_end = range(int(system[-1][4] - space * 0.6), int(system[-1][4]))
    xs = [x for x, v in enumerate(coverage)
          if v >= 255 * 0.93 and dark(x, top_end) > 0.75 and dark(x, bottom_end) > 0.75]
    groups = []
    for x in xs:
        if groups and x - groups[-1][-1] <= 1:
            groups[-1].append(x)
        else:
            groups.append([x])
    clusters = []
    for g in groups:
        if clusters and g[0] - clusters[-1][-1][-1] <= space * 1.0:
            clusters[-1].append(g)
        else:
            clusters.append([g])
    bars = []
    for cl in clusters:
        a, b = cl[0][0], cl[-1][-1]
        if any(g[-1] - g[0] + 1 > max(3, space * 0.8) for g in cl):
            continue
        if dark(a - 2, inner) > 0.5 or dark(b + 2, inner) > 0.5:
            continue
        if any(dark(x, above) > 0.5 or dark(x, below) > 0.5 for g in cl for x in (g[0], g[-1])):
            continue
        if any(space * 0.45 < min(abs(hx - a), abs(hx - b)) < space and top - space * 3 < hy < bottom + space * 3
               for hx, hy, _ in heads):
            continue
        bars.append((a, b))
    first_line = int(round(system[0][0]))
    staff_left = next((x for x in range(w) if px[x, first_line] < INK), 0)
    if not bars or bars[0][0] > staff_left + space * 2:
        bars.insert(0, (staff_left, staff_left))
    return bars


def components(img, limit):
    w, h = img.size
    px = img.load()
    dark = {(x, y) for y in range(h) for x in range(w) if px[x, y] < 128}
    seen = set()
    for start in dark:
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in dark and q not in seen:
                        seen.add(q)
                        stack.append(q)
        xs = [c[0] for c in comp]
        ys = [c[1] for c in comp]
        if max(xs) - min(xs) <= limit[0] and max(ys) - min(ys) <= limit[1]:
            yield (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def remove_staff_lines(binary, staves, space):
    px = binary.load()
    w, h = binary.size
    t = max(1, int(round(space * 0.1)))
    for staff in staves:
        for c in staff:
            yc = int(round(c))
            if yc - t - 1 < 0 or yc + t + 1 >= h:
                continue
            for x in range(w):
                if px[x, yc - t - 1] > 128 and px[x, yc + t + 1] > 128:
                    for y in range(yc - t, yc + t + 1):
                        px[x, y] = 255
    return binary


def detect_heads(gray, space, staves):
    """返回 [(x, y, hollow)]。实心符头直接腐蚀检测；空心符头先去谱线、闭运算填心后再检测。"""
    limit = (space * 1.1, space * 0.7)
    k = odd(space * 0.6)
    filled = [(x, y, False) for x, y in components(gray.filter(ImageFilter.MaxFilter(k)), limit)]

    binary = remove_staff_lines(gray.point(lambda v: 0 if v < INK else 255), staves, space)
    closed = binary.filter(ImageFilter.MinFilter(odd(space * 0.5))).filter(ImageFilter.MaxFilter(odd(space * 0.5)))
    px = binary.load()
    extra = []
    for hx, hy in components(closed.filter(ImageFilter.MaxFilter(k)), limit):
        if any(abs(hx - fx) < space * 0.6 and abs(hy - fy) < space * 0.4 for fx, fy, _ in filled):
            continue
        dx, dy = max(1, int(space * 0.2)), max(1, int(space * 0.12))
        box = [px[x, y] for x in range(int(hx) - dx, int(hx) + dx + 1) for y in range(int(hy) - dy, int(hy) + dy + 1)
               if 0 <= x < gray.width and 0 <= y < gray.height]
        extra.append((hx, hy, sum(v > 128 for v in box) / max(1, len(box)) > 0.25))
    return filled + extra


def draw_crop(gray, staves, clefs, x0, x1, space, out):
    scale = max(3, int(round(40 / space)))
    margin = int(space * 6)
    y0 = max(0, int(staves[0][0] - margin))
    y1 = min(gray.height, int(staves[-1][4] + margin))
    crop = gray.crop((max(0, x0 - 2), y0, x1 + 3, y1)).convert("RGB")
    big = Image.new("RGB", (crop.width * scale + 60, crop.height * scale), "white")
    big.paste(crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS), (60, 0))
    d = ImageDraw.Draw(big)
    bounds = [y0] + [(staves[i][4] + staves[i + 1][0]) / 2 for i in range(len(staves) - 1)] + [y1]
    for si, staff in enumerate(staves):
        sp = (staff[4] - staff[0]) / 4
        for p in range(14, -23, -1):
            y = staff[0] - p * sp / 2
            if not bounds[si] <= y < bounds[si + 1]:
                continue
            yy = (y - y0) * scale
            on_line = p % 2 == 0 and -8 <= p <= 0
            color = (200, 0, 0) if on_line else ((0, 0, 200) if p % 2 == 0 else (0, 140, 0))
            d.text((2, yy - 5), pitch_name(clefs[si], p), fill=color)
            d.line([(40, yy), (58, yy)], fill=color)
    big.save(out)


def parse_overrides(items):
    result = {}
    for item in items:
        try:
            page, system, x = (int(v) for v in item.split(":"))
        except ValueError:
            raise SystemExit(f"无法解析 {item}，格式应为 页:行:x，例如 2:3:845")
        result.setdefault((page, system), []).append(x)
    return result


def draw_overview(gray, systems, bars_by_system, numbers, out):
    img = gray.convert("RGB")
    d = ImageDraw.Draw(img)
    for system, bars, nums in zip(systems, bars_by_system, numbers):
        top, bottom = system[0][0], system[-1][4]
        for a, b in bars:
            d.rectangle([a - 1, top - 4, b + 1, bottom + 4], outline=(230, 0, 0), width=2)
        for (x0, _), num in nums:
            d.text((x0 + 3, top - 16), str(num), fill=(0, 0, 230))
    if img.width > 1400:
        img = img.resize((1400, int(img.height * 1400 / img.width)), Image.Resampling.LANCZOS)
    img.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("-o", "--out", default="score-work")
    ap.add_argument("--staves-per-system", type=int, default=2)
    ap.add_argument("--clefs", default="G,F", help="每个谱表的谱号，从上到下，可选 G F C G8")
    ap.add_argument("--add-bar", action="append", default=[], metavar="页:行:x", help="补一条漏检的小节线")
    ap.add_argument("--drop-bar", action="append", default=[], metavar="页:行:x", help="删掉 x 附近误检的小节线")
    args = ap.parse_args()
    clefs = args.clefs.split(",")
    if len(clefs) != args.staves_per_system:
        ap.error("--clefs 的个数必须等于 --staves-per-system")
    adds, drops = parse_overrides(args.add_bar), parse_overrides(args.drop_bar)
    out = pathlib.Path(args.out)
    for sub in ("crops", "pages", "overview"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    layout, head_lines, n = [], [], 0
    for page, path in enumerate(args.images, 1):
        gray, angle = load_page(path)
        page_path = out / "pages" / f"p{page}.png"
        gray.save(page_path)
        staves = find_staves(gray)
        if not staves:
            print(f"警告: {path} 未检测到谱表")
            continue
        if len(staves) % args.staves_per_system:
            print(f"警告: {path} 检测到 {len(staves)} 个五线谱，不是 {args.staves_per_system} 的整数倍，"
                  "检查 --staves-per-system 或是否有谱表漏检")
        systems = [staves[i:i + args.staves_per_system] for i in range(0, len(staves), args.staves_per_system)]
        space = sum(s[4] - s[0] for s in staves) / len(staves) / 4
        note = f"，已纠斜 {angle:+.1f}°" if angle else ""
        heads = detect_heads(gray, space, staves)
        all_bars, all_numbers, counts = [], [], []
        for si, system in enumerate(systems, 1):
            bars = find_barlines(gray, system, space, heads)
            for x in drops.get((page, si), []):
                bars = [bar for bar in bars if not bar[0] - space * 2 <= x <= bar[1] + space * 2]
            bars = sorted(bars + [(x, x) for x in adds.get((page, si), [])])
            nums = []
            for bi in range(len(bars) - 1):
                x0, x1 = bars[bi][1], bars[bi + 1][0]
                if x1 - x0 < space * 2:
                    continue
                n += 1
                nums.append(((x0, x1), n))
                draw_crop(gray, system, clefs, x0, x1, space, out / "crops" / f"m{n:02d}.png")
                layout.append({"measure": n, "image": str(page_path.resolve()), "page": page, "system": si,
                               "x0": x0, "x1": x1, "space": space, "staves": system, "clefs": clefs})
                cols = []
                for staff_i, staff in enumerate(system):
                    found = []
                    for hx, hy, hollow in sorted(heads):
                        if not x0 < hx < x1:
                            continue
                        nearest = min(range(len(system)), key=lambda j: abs(hy - (system[j][0] + system[j][4]) / 2))
                        if nearest != staff_i or abs(hy - (staff[0] + staff[4]) / 2) > space * 8:
                            continue
                        sp = (staff[4] - staff[0]) / 4
                        name = pitch_name(clefs[staff_i], round((staff[0] - hy) / (sp / 2)))
                        found.append(f"{int(hx)}:{name}{'o' if hollow else ''}")
                    cols.append(f"  staff{staff_i + 1}| " + " ".join(found))
                head_lines.append(f"M{n:02d} (p{page} s{si} x{x0}-{x1})\n" + "\n".join(cols))
            all_bars.append(bars)
            all_numbers.append(nums)
            counts.append(str(len(nums)))
        draw_overview(gray, systems, all_bars, all_numbers, out / "overview" / f"p{page}.png")
        print(f"第 {page} 页: {len(systems)} 行谱，各行小节数 {'/'.join(counts)}，线距 {space:.1f}px{note}")
        if space < 8:
            print("  提示: 线距小于 8px，属于低分辨率，OMR 软件基本不可用，符头检测误差也会变大")
    (out / "layout.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1))
    (out / "heads.txt").write_text("\n".join(head_lines) + "\n")
    print(f"共 {n} 小节 -> {out}/overview（先核对小节线）, {out}/crops, {out}/heads.txt")


if __name__ == "__main__":
    main()
