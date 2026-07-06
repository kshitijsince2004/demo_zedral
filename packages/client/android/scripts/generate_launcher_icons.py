#!/usr/bin/env python3
"""Generate Android launcher icons from packages/client/src/assets/white logo.png."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

# SaaS primary — packages/client/src/index.css --color-primary
BRAND_GREEN = (0x16, 0x33, 0x28, 255)
LOGO_PATH = Path(__file__).resolve().parents[2] / "src" / "assets" / "white logo.png"
RES_DIR = Path(__file__).resolve().parents[1] / "app" / "src" / "main" / "res"

DENSITIES = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}


def load_logo_rgba() -> Image.Image:
    img = Image.open(LOGO_PATH).convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            # Black/near-black background → transparent (keep white logo only).
            if r < 40 and g < 40 and b < 40:
                pixels[x, y] = (r, g, b, 0)
    return img


def fit_logo(logo: Image.Image, size: int, padding_ratio: float = 0.18) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * (1 - padding_ratio * 2))
    scale = min(inner / logo.width, inner / logo.height)
    nw, nh = max(1, int(logo.width * scale)), max(1, int(logo.height * scale))
    resized = logo.resize((nw, nh), Image.Resampling.LANCZOS)
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def composite_launcher(logo: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BRAND_GREEN)
    fg = fit_logo(logo, size, padding_ratio=0.16)
    canvas.alpha_composite(fg)
    return canvas.convert("RGB")


def round_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    from PIL import ImageDraw

    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def main() -> None:
    if not LOGO_PATH.is_file():
        raise SystemExit(f"Logo not found: {LOGO_PATH}")

    logo = load_logo_rgba()

    for folder, (launcher_px, foreground_px) in DENSITIES.items():
        out_dir = RES_DIR / folder
        out_dir.mkdir(parents=True, exist_ok=True)

        fg = fit_logo(logo, foreground_px)
        fg.save(out_dir / "ic_launcher_foreground.png")

        launcher = composite_launcher(logo, launcher_px)
        launcher.save(out_dir / "ic_launcher.png")

        round_icon = launcher.copy()
        mask = round_mask(launcher_px)
        round_rgba = round_icon.convert("RGBA")
        round_rgba.putalpha(mask)
        # Flatten onto brand green for round icon
        base = Image.new("RGBA", (launcher_px, launcher_px), BRAND_GREEN)
        base.alpha_composite(round_rgba)
        base.convert("RGB").save(out_dir / "ic_launcher_round.png")

    print(f"Generated launcher icons in {RES_DIR} from {LOGO_PATH.name}")


if __name__ == "__main__":
    main()
