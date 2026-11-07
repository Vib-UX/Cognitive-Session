"""Rasterize the Session mark into a square logo and a 16:9 cover."""

import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))

INK = (28, 27, 22)
PAPER = (250, 249, 245)
PAPER_2 = (244, 241, 234)
MUTED = (94, 91, 85)
FAINT = (138, 133, 124)
CLAY = (154, 64, 48)
PLATE = (31, 29, 25)

PAL = "/System/Library/Fonts/Palatino.ttc"
SANS = "/System/Library/Fonts/Avenir Next.ttc"

def font(size, face="pal", index=0):
    path = PAL if face == "pal" else SANS
    return ImageFont.truetype(path, size, index=index)


def svg_arc_points(x1, y1, x2, y2, rx, ry, phi_deg, fa, fs, n=240):
    """Same center parameterization the website SVG uses."""
    phi = math.radians(phi_deg)
    dx = (x1 - x2) / 2
    dy = (y1 - y2) / 2
    x1p = math.cos(phi) * dx + math.sin(phi) * dy
    y1p = -math.sin(phi) * dx + math.cos(phi) * dy
    rx2, ry2 = rx * rx, ry * ry
    x1p2, y1p2 = x1p * x1p, y1p * y1p
    lam = x1p2 / rx2 + y1p2 / ry2
    if lam > 1:
        s = math.sqrt(lam)
        rx *= s
        ry *= s
        rx2, ry2 = rx * rx, ry * ry
    num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2
    den = rx2 * y1p2 + ry2 * x1p2
    coef = math.sqrt(max(0, num / den))
    if fa == fs:
        coef = -coef
    cxp = coef * rx * y1p / ry
    cyp = coef * -ry * x1p / rx
    cx = math.cos(phi) * cxp - math.sin(phi) * cyp + (x1 + x2) / 2
    cy = math.sin(phi) * cxp + math.cos(phi) * cyp + (y1 + y2) / 2

    def angle(ux, uy, vx, vy):
        dot = ux * vx + uy * vy
        nrm = math.hypot(ux, uy) * math.hypot(vx, vy)
        a = math.acos(max(-1, min(1, dot / nrm)))
        if ux * vy - uy * vx < 0:
            a = -a
        return a

    theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if fs == 0 and dtheta > 0:
        dtheta -= 2 * math.pi
    elif fs == 1 and dtheta < 0:
        dtheta += 2 * math.pi
    pts = []
    for i in range(n + 1):
        t = theta1 + dtheta * i / n
        x = math.cos(phi) * rx * math.cos(t) - math.sin(phi) * ry * math.sin(t) + cx
        y = math.sin(phi) * rx * math.cos(t) + math.cos(phi) * ry * math.sin(t) + cy
        pts.append((x, y))
    return pts


# web/public/mark.svg — curves bow inward, closest at the middle.
LEFT_ARC = svg_arc_points(8.6, 8.2, 8.6, 23.8, 9.7, 9.7, 0, 0, 1)
RIGHT_ARC = svg_arc_points(23.4, 8.2, 23.4, 23.8, 9.7, 9.7, 0, 0, 0)
_XS = [p[0] for p in LEFT_ARC + RIGHT_ARC]
_YS = [p[1] for p in LEFT_ARC + RIGHT_ARC]
MARK_W = max(_XS) - min(_XS) + 2
MARK_H = max(_YS) - min(_YS) + 2


def draw_mark(draw, cx, cy, scale, color):
    stroke = 2 * scale
    radius = stroke / 2

    def paint(points):
        mapped = []
        for x, y in points:
            mapped.append((cx + (x - 16) * scale, cy + (y - 16) * scale))
        # Stamp a disc at each sample so the stroke has round caps.
        step = max(radius * 0.35, 0.8)
        dense = [mapped[0]]
        for p in mapped[1:]:
            px, py = dense[-1]
            dx, dy = p[0] - px, p[1] - py
            dist = math.hypot(dx, dy)
            n = max(1, int(dist / step))
            for i in range(1, n + 1):
                t = i / n
                dense.append((px + dx * t, py + dy * t))
        r = radius
        for x, y in dense:
            draw.ellipse((x - r, y - r, x + r, y + r), fill=color)

    paint(LEFT_ARC)
    paint(RIGHT_ARC)


def tracked(draw, x, y, text, face, fill, tracking, align="left"):
    widths = [face.getlength(ch) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    cursor = x - total / 2 if align == "center" else x
    for ch, w in zip(text, widths):
        draw.text((cursor, y), ch, font=face, fill=fill)
        cursor += w + tracking
    return total


def ink_height(face, text):
    box = face.getbbox(text)
    return box[3] - box[1]


def render_logo(path, bg, fg, size=512, ssaa=4):
    s = size * ssaa
    image = Image.new("RGB", (s, s), bg)
    draw = ImageDraw.Draw(image)
    # The inward mark is about 16.8 units wide. Keep padding around it.
    scale = (size * 0.58) / MARK_W * ssaa
    draw_mark(draw, s / 2, s / 2, scale, fg)
    image.resize((size, size), Image.Resampling.LANCZOS).save(path, "PNG", optimize=True)


def render_cover(path, w=1920, h=1080, ssaa=2):
    sw, sh = w * ssaa, h * ssaa
    image = Image.new("RGB", (sw, sh), PAPER)
    draw = ImageDraw.Draw(image)

    # Large mark on the right. The curves pinch in the middle, so type stays on the left.
    scale = 34 * ssaa
    mark_w = MARK_W * scale
    margin = 96 * ssaa
    draw_mark(draw, sw - margin - mark_w / 2, sh / 2, scale, INK)

    head = font(int(76 * ssaa))
    deck = font(int(26 * ssaa), index=1)
    name = font(int(36 * ssaa))
    meta = font(int(15 * ssaa), face="sans", index=5)

    head_lines = ["P2P connect inside", "your agentic session."]
    deck_lines = ["Battle in the editor while both agents build.", "The winner gets the token credits."]
    head_gap = int(10 * ssaa)
    deck_gap = int(6 * ssaa)
    name_h = ink_height(name, "session")
    head_h = ink_height(head, "Ag")
    deck_h = ink_height(deck, "Ag")
    rule = 3 * ssaa
    block = (
        name_h
        + 26 * ssaa
        + rule
        + 36 * ssaa
        + head_h * 2
        + head_gap
        + 32 * ssaa
        + deck_h * 2
        + deck_gap
        + 40 * ssaa
        + ink_height(meta, "CHESS")
    )
    y = (sh - block) / 2
    x = margin

    tracked(draw, x, y, "session", name, INK, tracking=-1.2 * ssaa, align="left")
    y += name_h + 26 * ssaa
    draw.rectangle((x, y, x + 56 * ssaa, y + rule), fill=CLAY)
    y += rule + 36 * ssaa

    for line in head_lines:
        tracked(draw, x, y, line, head, INK, tracking=-1.6 * ssaa, align="left")
        y += head_h + head_gap
    y += 32 * ssaa - head_gap

    for line in deck_lines:
        tracked(draw, x, y, line, deck, MUTED, tracking=-0.3 * ssaa, align="left")
        y += deck_h + deck_gap
    y += 40 * ssaa - deck_gap

    tracked(draw, x, y, "CHESS      FLAPPY      CREDITS", meta, FAINT, tracking=1.6 * ssaa, align="left")

    image.resize((w, h), Image.Resampling.LANCZOS).save(path, "PNG", optimize=True)


def main():
    os.makedirs(ROOT, exist_ok=True)
    render_logo(os.path.join(ROOT, "logo.png"), PAPER, INK)
    render_logo(os.path.join(ROOT, "logo-dark.png"), PLATE, PAPER)
    render_cover(os.path.join(ROOT, "cover.png"))
    print("wrote", ROOT)


if __name__ == "__main__":
    main()
