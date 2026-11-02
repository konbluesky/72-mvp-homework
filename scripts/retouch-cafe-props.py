"""Remove obsolete story lettering from two existing backgrounds, using local pixels only.

Usage: python scripts/retouch-cafe-props.py <original-background-directory> <output-directory>
Requires Pillow and NumPy. No model, network, credentials, or image generation service.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def wall_art(original):
    image = original.convert("RGB")
    # Limit the edit to the lettering inside the painted frame; retain its coastal scene.
    region = (160, 106, 350, 253)
    crop = image.crop(region)
    pixels = np.asarray(crop)
    mask = Image.fromarray((np.mean(pixels, axis=2) < 133).astype("uint8") * 255)
    mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(0.6))
    # A local median reconstructs the existing paper tone and lighting beneath the ink.
    paper = image.filter(ImageFilter.MedianFilter(39)).crop(region)
    image.paste(paper, region[:2], mask)
    return image


def menu_card(original):
    image = original.convert("RGB")
    # Keep the tray, card outline and surrounding wood; replace the envelope face only.
    width, height = 360, 130
    rng = np.random.default_rng(12)
    yy, xx = np.mgrid[:height, :width]
    light = 2.0 * xx / width - 5.0 * yy / height + rng.normal(0, 0.75, (height, width))
    paper = np.clip(np.array([207, 184, 147]) + light[..., None], 0, 255).astype("uint8")
    card = Image.fromarray(paper, "RGB")
    draw = ImageDraw.Draw(card)
    font_path = "/System/Library/Fonts/Supplemental/Times New Roman.ttf"
    title = ImageFont.truetype(font_path, 28)
    body = ImageFont.truetype(font_path, 21)
    draw.text((180, 18), "MENU", font=title, anchor="mt", fill=(86, 66, 46))
    draw.line([(71, 62), (289, 62)], fill=(134, 109, 77), width=1)
    draw.text((180, 77), "Coffee  /  Tea", font=body, anchor="mt", fill=(95, 74, 51))
    # Project the printed card onto the existing paper plane.
    quad = [(1042, 620), (1189, 612), (1203, 669), (1051, 676)]
    corners = [(0, 0), (width, 0), (width, height), (0, height)]
    matrix, values = [], []
    for (x, y), (u, v) in zip(quad, corners):
        matrix += [[x, y, 1, 0, 0, 0, -u * x, -u * y],
                   [0, 0, 0, x, y, 1, -v * x, -v * y]]
        values += [u, v]
    coefficients = np.linalg.solve(matrix, values)
    projected = card.transform(image.size, Image.Transform.PERSPECTIVE, coefficients,
                               resample=Image.Resampling.BICUBIC)
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).polygon(quad, fill=255)
    image.paste(projected, (0, 0), mask.filter(ImageFilter.GaussianBlur(0.6)))
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name, edit in [("photo-corridor", wall_art), ("counter", menu_card)]:
        with Image.open(args.source / f"{name}.webp") as original:
            image = edit(original)
        image.save(args.output / f"{name}.webp", "WEBP", quality=94, method=6)
        image.save(args.output / f"{name}.png")


if __name__ == "__main__":
    main()
