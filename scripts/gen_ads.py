#!/usr/bin/env python3
"""Generate ResumeTailored AI social ad images (no Canva, pure Pillow)."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "assets", "ads")
os.makedirs(OUT, exist_ok=True)

FONT_DIR = "/usr/share/fonts/truetype/liberation"
REG = os.path.join(FONT_DIR, "LiberationSans-Regular.ttf")
BOLD = os.path.join(FONT_DIR, "LiberationSans-Bold.ttf")

# Brand palette
BG_TOP = (10, 10, 31)      # #0a0a1f
BG_BOT = (3, 7, 18)        # #030712
INDIGO = (99, 102, 241)    # #6366F1
VIOLET = (139, 92, 246)    # #8B5CF6
SKY = (56, 189, 248)       # #38BDF8
TEXT = (248, 250, 252)     # #f8fafc
MUTED = (148, 163, 184)    # #94a3b8
EYEBROW = (129, 140, 248)  # #818CF8
GREEN = (52, 211, 153)


def font(path, size):
    return ImageFont.truetype(path, size)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(size, top, bot):
    w, h = size
    base = Image.new("RGB", size, bot)
    col = Image.new("RGB", (1, h))
    for y in range(h):
        col.putpixel((0, y), lerp(top, bot, y / max(1, h - 1)))
    return col.resize(size)


def radial_glow(size, center, radius, color, max_alpha):
    """Soft radial glow as an RGBA layer."""
    w, h = size
    # build on a smaller canvas for speed, then blur + upscale
    s = 0.5
    sw, sh = int(w * s), int(h * s)
    layer = Image.new("L", (sw, sh), 0)
    d = ImageDraw.Draw(layer)
    cx, cy = int(center[0] * s), int(center[1] * s)
    r = int(radius * s)
    steps = 60
    for i in range(steps, 0, -1):
        t = i / steps
        a = int(max_alpha * (1 - t) ** 2)
        rr = int(r * t)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=a)
    layer = layer.resize((w, h)).filter(ImageFilter.GaussianBlur(60))
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    solid = Image.new("RGBA", size, color + (255,))
    out.paste(solid, (0, 0), layer)
    return out


def grid(size, color, spacing=64, alpha=12):
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x in range(0, w, spacing):
        d.line([(x, 0), (x, h)], fill=color + (alpha,), width=1)
    for y in range(0, h, spacing):
        d.line([(0, y), (w, y)], fill=color + (alpha,), width=1)
    return layer


def text_w(s, fnt, tracking):
    if not s:
        return 0
    return sum(fnt.getlength(c) for c in s) + tracking * (len(s) - 1)


def draw_tracked(img, draw, xy, s, fnt, fill, tracking):
    x, y = xy
    for c in s:
        draw.text((x, y), c, font=fnt, fill=fill)
        x += fnt.getlength(c) + tracking


def grad_word(img, xy, s, fnt, c1, c2, tracking):
    """Paste a horizontal-gradient-filled word."""
    w = int(text_w(s, fnt, tracking)) + 4
    asc, desc = fnt.getmetrics()
    h = asc + desc + 4
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    draw_tracked(mask, md, (0, 0), s, fnt, 255, tracking)
    grad = Image.new("RGB", (w, h))
    for x in range(w):
        grad.paste(lerp(c1, c2, x / max(1, w - 1)), (x, 0, x + 1, h))
    img.paste(grad, (int(xy[0]), int(xy[1])), mask)


def layout_headline(img, draw, tokens, fnt, xy, max_w, tracking, leading, color):
    """tokens: list of (word, grad_bool). Word-wrap; gradient words filled."""
    space = fnt.getlength(" ")
    x0, y = xy
    lines, cur, curw = [], [], 0
    for word, g in tokens:
        ww = text_w(word, fnt, tracking)
        if cur and curw + space + ww > max_w:
            lines.append(cur)
            cur, curw = [], 0
        cur.append((word, g, ww))
        curw += (space if len(cur) > 1 else 0) + ww
    if cur:
        lines.append(cur)
    asc, desc = fnt.getmetrics()
    lh = asc + desc + leading
    for line in lines:
        x = x0
        for word, g, ww in line:
            if g:
                grad_word(img, (x, y), word, fnt, INDIGO, SKY, tracking)
            else:
                draw_tracked(img, draw, (x, y), word, fnt, color, tracking)
            x += ww + space
        y += lh
    return y


def pill(img, draw, xy, label, fnt, pad=(34, 20)):
    tw = text_w(label, fnt, 1)
    w = int(tw + pad[0] * 2)
    asc, desc = fnt.getmetrics()
    h = asc + desc + pad[1] * 2
    x, y = xy
    # glow
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle([x - 6, y - 6, x + w + 6, y + h + 6], radius=h // 2 + 6,
                         fill=INDIGO + (90,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
    # button gradient
    btn = Image.new("RGB", (w, h))
    for i in range(w):
        btn.paste(lerp(INDIGO, VIOLET, i / max(1, w - 1)), (i, 0, i + 1, h))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w, h], radius=h // 2, fill=255)
    img.paste(btn, (x, y), mask)
    d2 = ImageDraw.Draw(img)
    draw_tracked(img, d2, (x + pad[0], y + pad[1]), label, fnt, (255, 255, 255), 1)
    return w, h


def base_canvas(size, glow_center):
    img = vgrad(size, BG_TOP, BG_BOT).convert("RGBA")
    img.alpha_composite(grid(size, INDIGO, spacing=max(48, size[0] // 18), alpha=10))
    img.alpha_composite(radial_glow(size, glow_center, int(size[0] * 0.55), VIOLET, 120))
    img.alpha_composite(radial_glow(size, (size[0] * 0.85, size[1] * 0.1),
                                    int(size[0] * 0.4), SKY, 60))
    return img


def wordmark(img, draw, xy, scale=1.0):
    x, y = xy
    f = font(BOLD, int(26 * scale))
    draw_tracked(img, draw, (x, y), "ResumeTailored", f, TEXT, 0.3)
    bx = x + text_w("ResumeTailored", f, 0.3) + 10
    asc, desc = f.getmetrics()
    bw = int(text_w("AI", f, 0.3) + 20)
    bh = asc + desc
    btn = Image.new("RGB", (bw, bh))
    for i in range(bw):
        btn.paste(lerp(INDIGO, VIOLET, i / max(1, bw - 1)), (i, 0, i + 1, bh))
    m = Image.new("L", (bw, bh), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, bw, bh], radius=8, fill=255)
    img.paste(btn, (int(bx), int(y)), m)
    draw_tracked(img, draw, (bx + 10, y), "AI", f, (255, 255, 255), 0.3)


def footer(img, draw, size, pad):
    f = font(REG, int(22 if size[0] > 1100 else 24))
    s = "resumetailored.com"
    sw = text_w(s, f, 1)
    draw_tracked(img, draw, (size[0] - pad - sw, size[1] - pad - 6), s, f, MUTED, 1)


CONCEPTS = [
    dict(name="brand",
         eyebrow="AI RESUME TAILORING",
         head=[("Your", 0), ("resume,", 0), ("perfectly", 1), ("tailored", 1),
               ("to", 0), ("every", 0), ("job.", 0)],
         sub="Powered by Anthropic Claude — rewritten for any job in ~30 seconds.",
         cta="Tailor My Resume Free  →"),
    dict(name="ats",
         eyebrow="PASS THE ATS SCAN",
         big="97%", big_label="average ATS match score",
         head=[("Stop", 0), ("getting", 0), ("auto-rejected.", 1)],
         sub="Keyword-optimized, ATS-safe formatting — automatically.",
         cta="Check My Score Free  →"),
    dict(name="freetier",
         eyebrow="NO CREDIT CARD · FOREVER",
         head=[("1", 1), ("free", 1), ("resume", 0), ("tailoring", 0), ("+", 0),
               ("cover", 0), ("letter.", 0), ("Every", 0), ("day.", 0)],
         sub="The only AI resume tool with a genuinely free daily tier.",
         cta="Start Free  →"),
    dict(name="speed",
         eyebrow="LINKEDIN · INDEED · 40+ JOB BOARDS",
         head=[("Paste", 0), ("any", 0), ("job", 0), ("link.", 0), ("Tailored", 1),
               ("resume", 1), ("in", 0), ("30s.", 0)],
         sub="AI auto-reads the posting and writes your cover letter too.",
         cta="Tailor My Resume Free  →"),
]


def render(concept, size):
    w, h = size
    pad = int(w * 0.07)
    img = base_canvas(size, (w * 0.2, h * 0.3))
    draw = ImageDraw.Draw(img)
    wordmark(img, draw, (pad, pad), scale=1.0 if w > 1100 else 1.1)

    big = concept.get("big")
    y = int(h * 0.23) if big else (int(h * 0.30) if w > 1100 else int(h * 0.26))
    ef = font(BOLD, int(w * 0.018) + 6)
    draw_tracked(img, draw, (pad, y), concept["eyebrow"], ef, EYEBROW, 3)
    y += ef.getmetrics()[0] + 26

    if big:
        bf = font(BOLD, int(h * 0.20))
        grad_word(img, (pad, y), concept["big"], bf, INDIGO, SKY, 0)
        lf = font(REG, int(w * 0.022))
        bw = text_w(concept["big"], bf, 0)
        draw_tracked(img, draw, (pad + bw + 28, y + int(h * 0.055)),
                     concept["big_label"], lf, MUTED, 1)
        y += bf.getmetrics()[0] + 4

    if big:
        hf = font(REG, int(w * 0.040))
    else:
        hf = font(REG, int(w * 0.044) if w > 1100 else int(w * 0.055))
    y = layout_headline(img, draw, concept["head"], hf, (pad, y),
                        w - pad * 2, tracking=0.5, leading=10, color=TEXT)

    y += 8
    sf = font(REG, int(w * 0.0225))
    # wrap sub
    words = concept["sub"].split()
    line, lines = "", []
    for wd in words:
        t = (line + " " + wd).strip()
        if sf.getlength(t) > w - pad * 2:
            lines.append(line); line = wd
        else:
            line = t
    if line:
        lines.append(line)
    for ln in lines:
        draw_tracked(img, draw, (pad, y), ln, sf, MUTED, 0.3)
        y += sf.getmetrics()[0] + 8

    # CTA pill near bottom
    cf = font(BOLD, int(w * 0.022))
    pill(img, draw, (pad, h - pad - 64), concept["cta"], cf)
    footer(img, draw, size, pad)

    return img.convert("RGB")


SIZES = {"linkedin-1200x627": (1200, 627), "square-1080x1080": (1080, 1080)}

made = []
for c in CONCEPTS:
    for sname, sz in SIZES.items():
        im = render(c, sz)
        fn = os.path.join(OUT, f"{c['name']}-{sname}.png")
        im.save(fn, "PNG")
        made.append(fn)
print("\n".join(made))
print(f"TOTAL {len(made)} images")
