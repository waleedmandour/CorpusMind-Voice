#!/usr/bin/env python3
"""Generate the complete CorpusMind Voice icon set from the 1024px master.
Outputs: PWA icons, favicon.ico, Apple touch icon, Tauri icon set (png/ico/icns).
Theme: CorpusMind navy gradient + cyan E hemisphere + gold Arabic hemisphere + voice waveform.
"""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = "/home/z/my-project"
DESIGN = f"{ROOT}/design"
PUBLIC = f"{ROOT}/public/icons"
TAURI = f"{ROOT}/src-tauri/icons"
os.makedirs(PUBLIC, exist_ok=True)
os.makedirs(TAURI, exist_ok=True)

RADIUS = 150  # rounded corner radius at 1024

def rounded(im: Image.Image, radius=RADIUS) -> Image.Image:
    """Apply rounded-corner transparency mask."""
    im = im.convert("RGBA")
    mask = Image.new("L", im.size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=radius, fill=255)
    im.putalpha(mask)
    return im

def edge_gradient(size: int) -> Image.Image:
    """Vertical gradient sampled from the master tile's edge colors (seamless corners)."""
    top = (44, 54, 84)      # sampled near top edge of tile
    mid = (34, 34, 62)      # mid navy-indigo
    bot = (44, 26, 58)      # bottom purple tint
    g = Image.new("RGB", (size, size))
    px = g.load()
    for y in range(size):
        t = y / (size - 1)
        if t < 0.5:
            k = t / 0.5
            c = tuple(int(top[i] + (mid[i] - top[i]) * k) for i in range(3))
        else:
            k = (t - 0.5) / 0.5
            c = tuple(int(mid[i] + (bot[i] - mid[i]) * k) for i in range(3))
        for x in range(size):
            px[x, y] = c
    return g

master = Image.open(f"{DESIGN}/icon-master.png").convert("RGB")
tile = rounded(master)

def paste_seamless(base_size: int, inner: Image.Image, scale: float = 1.0) -> Image.Image:
    """Paste rounded tile onto seamless gradient bg (corners look full-bleed)."""
    bg = edge_gradient(base_size).convert("RGBA")
    if scale < 1.0:
        s = int(base_size * scale)
        inner = inner.resize((s, s), Image.LANCZOS)
        off = (base_size - s) // 2
        bg.alpha_composite(inner, (off, off))
    else:
        bg.alpha_composite(inner)
    return bg

# ---------- PWA / web icons ----------
tile1024 = tile.resize((1024, 1024), Image.LANCZOS)
sizes = {
    "icon-512.png": 512, "icon-192.png": 192, "icon-256.png": 256,
    "icon-128.png": 128, "icon-64.png": 64, "icon-48.png": 48, "icon-32.png": 32,
}
for name, s in sizes.items():
    tile.resize((s, s), Image.LANCZOS).save(f"{PUBLIC}/{name}")
    if s >= 128:
        tile.resize((s, s), Image.LANCZOS).save(f"{DESIGN}/{name}")

# Apple touch icon (opaque, full-bleed, no transparency)
apple = paste_seamless(180, tile.resize((180, 180), Image.LANCZOS)).convert("RGB")
apple.save(f"{PUBLIC}/apple-touch-icon.png")

# Maskable icons: artwork inside 80% safe zone on full-bleed gradient
for s in (192, 512):
    m = paste_seamless(s, tile, scale=0.76)
    m.convert("RGB").save(f"{PUBLIC}/maskable-{s}.png")

# favicon.ico (16/32/48)
ico_sizes = [(16, 16), (32, 32), (48, 48)]
tile.resize((48, 48), Image.LANCZOS).save(f"{PUBLIC}/favicon.ico", sizes=ico_sizes)
tile.resize((32, 32), Image.LANCZOS).save(f"{PUBLIC}/favicon-32.png")
tile.resize((16, 16), Image.LANCZOS).save(f"{PUBLIC}/favicon-16.png")

# ---------- Tauri icon set ----------
for name, s in (("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)):
    tile.resize((s, s), Image.LANCZOS).save(f"{TAURI}/{name}")

# Windows .ico (multi-resolution)
tile.resize((256, 256), Image.LANCZOS).save(f"{TAURI}/icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# macOS .icns — Pillow ICNS writer (needs >=512 base)
try:
    big = tile1024.resize((1024, 1024), Image.LANCZOS)
    big.save(f"{TAURI}/icon.icns")
    print("icns: OK")
except Exception as e:
    print("icns FAILED:", e)

# Square (full-bleed) StoreIcon for Tauri Windows + splash-ish 1024
paste_seamless(1024, tile1024).convert("RGB").save(f"{TAURI}/StoreLogo.png")

print("PWA icons:", sorted(os.listdir(PUBLIC)))
print("Tauri icons:", sorted(os.listdir(TAURI)))
