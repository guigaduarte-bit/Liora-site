#!/usr/bin/env python3
"""Generate responsive WebP derivatives without changing source images.

Run manually with Python and Pillow; it is not a Vercel build dependency.
Sources never upscale or crop. Variants larger than the source are omitted.
Only variants smaller in bytes than their source enter the manifest.
"""

import hashlib
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "images"
DEST_DIR = SOURCE_DIR / "responsive"
MANIFEST = ROOT / "content" / "image-manifest.json"


def image_widths(source):
    if source.name == "logo.jpg":
        return [96, 192]
    if source.name == "eiffel.jpg":
        return [360, 720, 960, 1440]
    return [360, 720]


def generate():
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    manifest = {}
    variant_count = 0
    source_bytes = selected_bytes = 0

    for source in sorted(SOURCE_DIR.iterdir()):
        if not source.is_file() or source.suffix.lower() not in {".webp", ".jpg", ".jpeg", ".png"}:
            continue
        original = source.read_bytes()
        original_hash = hashlib.sha256(original).hexdigest()
        with Image.open(BytesIO(original)) as opened:
            picture = ImageOps.exif_transpose(opened)
            picture = picture.convert("RGBA" if "A" in picture.getbands() else "RGB")
            width, height = picture.size
            entry = {"width": width, "height": height, "variants": [], "bytes": len(original)}
            for target_width in image_widths(source):
                # Same-size JPEG conversion is useful for the 960px hero.
                if target_width > width or (target_width == width and source.suffix.lower() == ".webp"):
                    continue
                target_height = max(1, round(height * target_width / width))
                variant = picture.resize((target_width, target_height), Image.Resampling.LANCZOS)
                encoded = BytesIO()
                variant.save(encoded, "WEBP", quality=90 if source.name == "logo.jpg" else 85, method=6)
                blob = encoded.getvalue()
                output = DEST_DIR / f"{source.stem}-{target_width}.webp"
                if len(blob) >= len(original):
                    if output.exists():
                        output.unlink()
                    continue
                output.write_bytes(blob)
                with Image.open(output) as checked:
                    assert checked.size == (target_width, target_height)
                    assert checked.format == "WEBP"
                entry["variants"].append({
                    "src": "/" + output.relative_to(ROOT).as_posix(),
                    "width": target_width,
                    "height": target_height,
                    "bytes": len(blob),
                })
                variant_count += 1
            manifest["/" + source.relative_to(ROOT).as_posix()] = entry
        assert hashlib.sha256(source.read_bytes()).hexdigest() == original_hash, f"Source changed: {source}"
        source_bytes += len(original)
        selected_bytes += min([len(original)] + [v["bytes"] for v in entry["variants"]])

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "sources": len(manifest),
        "variants": variant_count,
        "all_originals_bytes": source_bytes,
        "smallest_variant_per_source_bytes": selected_bytes,
        "potential_small_image_saving_bytes": source_bytes - selected_bytes,
        "potential_small_image_saving_percent": round((1 - selected_bytes / source_bytes) * 100, 2),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    generate()
