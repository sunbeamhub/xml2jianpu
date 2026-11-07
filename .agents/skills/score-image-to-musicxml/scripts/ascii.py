#!/usr/bin/env python3
"""把某小节某一谱表的像素打印成 ASCII，用于精确判断符头在线上还是间里。

用法:
  python ascii.py work/layout.json 13 --staff 1 [--x0 515 --x1 585] [--above 5 --below 5] [--step N]

左侧标签: "F5-" 表示该行是谱线（或加线）位置，"E5 " 表示间的中心。
字符: '#' 深色, '+' 浅灰（抗锯齿/细谱线）, '.' 白。
符头中心 = 符头所占行的中点；落在 "X-" 行为线上音，落在 "X " 行为间里音。
高分辨率图会自动按 --step 缩采样（每格取块内最深的像素），使一个线距约 5 行。
顶部刻度给出原图 x 坐标，可用于 measures.py 的 --add-bar/--drop-bar 和 --x0/--x1。
"""
import argparse
import json

from PIL import Image

STEPS = "CDEFGAB"
CLEF_TOP_LINE = {"G": ("F", 5), "F": ("A", 3), "C": ("G", 4), "G8": ("F", 4)}


def pitch_name(clef, steps_above_top):
    step, octave = CLEF_TOP_LINE[clef]
    i = STEPS.index(step) + octave * 7 + steps_above_top
    return f"{STEPS[i % 7]}{i // 7}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("layout")
    ap.add_argument("measure", type=int)
    ap.add_argument("--staff", type=int, default=1)
    ap.add_argument("--x0", type=int)
    ap.add_argument("--x1", type=int)
    ap.add_argument("--above", type=float, default=5, help="谱表上方显示多少个线距")
    ap.add_argument("--below", type=float, default=5, help="谱表下方显示多少个线距")
    ap.add_argument("--step", type=int, help="缩采样步长（像素），默认按线距自动")
    args = ap.parse_args()

    info = next((m for m in json.load(open(args.layout)) if m["measure"] == args.measure), None)
    if info is None:
        raise SystemExit(f"layout 里没有第 {args.measure} 小节")
    staff = info["staves"][args.staff - 1]
    clef = info["clefs"][args.staff - 1]
    space = (staff[4] - staff[0]) / 4
    step = args.step or max(1, round(space / 5))
    x0 = args.x0 if args.x0 is not None else info["x0"]
    x1 = args.x1 if args.x1 is not None else info["x1"]
    img = Image.open(info["image"]).convert("L")

    top = staff[0]
    y_start = max(0, int(top - space * args.above))
    y_end = min(img.height - 1, int(staff[4] + space * args.below))
    region = img.crop((x0, y_start, x1, y_end + 1))
    if step > 1:
        region = region.reduce(step)
    px = region.load()
    def y_of(p):
        if p >= 0:
            return staff[0] - p * space / 2
        if p <= -8:
            return staff[4] - (p + 8) * space / 2
        i = -p // 2
        return staff[i] if p % 2 == 0 else (staff[i] + staff[i + 1]) / 2

    labels = {}
    for p in range(int(args.above * 2) + 1, -int(8 + args.below * 2) - 2, -1):
        r = int((y_of(p) + 0.5 - y_start) // step)
        labels.setdefault(r, pitch_name(clef, p) + ("-" if p % 2 == 0 else " "))

    print(f"     x={x0}..{x1}，每字符 {step}px")
    print("     " + "".join(f"{x0 + c * step:<10}" for c in range(0, region.width, 10)))
    for r in range(region.height):
        line = "".join("#" if px[c, r] < 120 else ("+" if px[c, r] < 215 else ".") for c in range(region.width))
        print(f"{labels.get(r, ''):>4} {line}")


if __name__ == "__main__":
    main()
