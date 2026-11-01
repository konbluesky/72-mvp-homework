"""Package approved raster backgrounds; never calls an image API or reads credentials.

Usage: python scripts/prepare-cafe-art.py outputs/cafe-art-refresh/final
Requires Pillow. Keep native generated PNGs outside the public runtime directory.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageOps


BASES = (
    "street-wide",
    "cafe-front",
    "lobby",
    "window-seat",
    "photo-corridor",
    "washroom",
    "counter",
    "street-walk",
)
VARIANTS = ("cafe-front-closed", "street-wide-closed", "street-walk-closed")
RUNTIME_SIZE = (1664, 936)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    destination = root / "apps/web/public/assets/cafe-story"
    prepared = {}
    native_sizes = {}

    # Validate the complete set before replacing any runtime file.
    for name in (*BASES, *VARIANTS):
        with Image.open(args.source / f"{name}.png") as source:
            source.load()
            if source.width < RUNTIME_SIZE[0] or source.height < RUNTIME_SIZE[1]:
                raise ValueError(f"{name}: refusing to upscale a small source image")
            if abs(source.width / source.height - 16 / 9) > 0.02:
                raise ValueError(f"{name}: expected a landscape 16:9 background")
            native_sizes[name] = list(source.size)
            prepared[name] = ImageOps.fit(
                source.convert("RGB"), RUNTIME_SIZE, method=Image.Resampling.LANCZOS
            )

    destination.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, image in prepared.items():
        path = destination / f"{name}.webp"
        image.save(path, "WEBP", quality=91, method=6)
        data = path.read_bytes()
        files[path.name] = {
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "width": image.width,
            "height": image.height,
        }

    sources = {
        "author": "AI-generated project environment artwork, directed and reviewed with Codex",
        "license": "Generated artwork subject to the configured image provider's terms; no Live2D character content included",
        "generatedOn": "2026-11-01",
        "model": "gpt-image-2",
        "method": "imagegen bundled CLI through the user-authorized OpenAI-compatible provider; reference-guided scenes and lighting edits",
        "prompts": "assets/cafe-story-prompts/PROMPTS.md",
        "generator": "scripts/prepare-cafe-art.py (local packaging only)",
        "baseBackgrounds": list(BASES),
        "variants": list(VARIANTS),
        "requestedSize": [2560, 1440],
        "returnedSizes": native_sizes,
        "runtimeSize": list(RUNTIME_SIZE),
        "processing": "Minimal aspect-ratio correction and downsampling; WebP quality 91; no upscaling",
        "files": files,
    }
    (destination / "SOURCES.json").write_text(
        json.dumps(sources, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"Packaged {len(files)} backgrounds, {sum(x['bytes'] for x in files.values()):,} bytes")


if __name__ == "__main__":
    main()
