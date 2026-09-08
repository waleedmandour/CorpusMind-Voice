#!/usr/bin/env python3
"""Regenerate the complete CorpusMind Voice icon set from the clean master
(design/CorpusMindVoiceIcon.png — purple brain+mic tile, NO white border).

Replaces the legacy dark icon (which carried a thick white outline) everywhere:
  public/icons/*      PWA + favicon + apple-touch + maskable
  src-tauri/icons/*   Tauri png / ico / icns / StoreLogo
"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = f"{ROOT}/design/CorpusMindVoiceIcon.png"
PUBLIC = f"{ROOT}/public/icons"
TAURI = f"{ROOT}/src-tauri/icons"
os.makedirs(PUBLIC, exist_ok=True)
os.makedirs(TAURI, exist_ok=True)

# ---- master tile: crop to content bbox, then normalize onto 1024 canvas ----
src = Image.open(MASTER).convert("RGBA")
tile_small = src.crop(src.getbbox())            # 396x396 rounded square
TILE = tile_small.resize((1024, 1024), Image.LANCZOS)
# re-apply a crisp rounded mask at 1024 so upscaled corners stay clean
mask = Image.new("L", TILE.size, 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, 1023, 1023], radius=232, fill=255)
TILE.putalpha(mask)

# ---- seamless background gradient sampled from the tile's own edges ----
TOP = (143, 188, 230)   # light periwinkle (top edge)
MID = (40, 46, 109)     # indigo (side edges)
BOT = (21, 22, 70)      # deep navy (bottom edge)

def bg_gradient(size: int) -> Image.Image:
    g = Image.new("RGB", (size, size))
    px = g.load()
    for y in range(size):
        t = y / (size - 1)
        if t < 0.5:
            k = t / 0.5
            c = tuple(int(TOP[i] + (MID[i] - TOP[i]) * k) for i in range(3))
        else:
            k = (t - 0.5) / 0.5
            c = tuple(int(MID[i] + (BOT[i] - MID[i]) * k) for i in range(3))
        for x in range(size):
            px[x, y] = c
    return g

def full_bleed(size: int, scale: float = 1.0) -> Image.Image:
    """Opaque icon: gradient bg + tile at `scale` (for maskable safe zones)."""
    base = bg_gradient(size).convert("RGBA")
    s = int(size * scale)
    inner = TILE.resize((s, s), Image.LANCZOS)
    base.alpha_composite(inner, ((size - s) // 2, (size - s) // 2))
    return base

# ---------- PWA / web icons (transparent corners) ----------
for s in (512, 256, 192, 128, 64, 48, 32):
    TILE.resize((s, s), Image.LANCZOS).save(f"{PUBLIC}/icon-{s}.png")

# Apple touch icon (opaque, full-bleed, no transparency)
full_bleed(180).convert("RGB").save(f"{PUBLIC}/apple-touch-icon.png")

# Maskable: artwork inside ~80% safe zone on full-bleed gradient
for s in (192, 512):
    full_bleed(s, scale=0.78).convert("RGB").save(f"{PUBLIC}/maskable-{s}.png")

# favicons
TILE.resize((48, 48), Image.LANCZOS).save(f"{PUBLIC}/favicon.ico",
    sizes=[(16, 16), (32, 32), (48, 48)])
TILE.resize((32, 32), Image.LANCZOS).save(f"{PUBLIC}/favicon-32.png")
TILE.resize((16, 16), Image.LANCZOS).save(f"{PUBLIC}/favicon-16.png")

# ---------- Tauri icon set ----------
for name, s in (("32x32.png", 32), ("128x128.png", 128),
                ("128x128@2x.png", 256), ("icon.png", 512)):
    TILE.resize((s, s), Image.LANCZOS).save(f"{TAURI}/{name}")

TILE.resize((256, 256), Image.LANCZOS).save(f"{TAURI}/icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

TILE.save(f"{TAURI}/icon.icns")           # Pillow ICNS writer (PNG-based)
full_bleed(1024).convert("RGB").save(f"{TAURI}/StoreLogo.png")

print("icon set regenerated from clean master — no white border")
