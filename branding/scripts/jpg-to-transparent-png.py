#!/usr/bin/env python3
"""Convert logo JPGs to PNG with transparent outer background (white margins)."""

from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image


def color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def is_background_pixel(rgb: tuple[int, int, int], tolerance: int) -> bool:
    r, g, b = rgb
    # White / near-white outer margins and light anti-alias fringe.
    if r >= 245 and g >= 245 and b >= 245:
        return True
    # Very light gray fringe from JPEG compression at rounded corners.
    if min(r, g, b) >= 230 and color_distance(rgb, (255, 255, 255)) <= tolerance:
        return True
    return False


def flood_transparent(image: Image.Image, tolerance: int) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited = [[False] * width for _ in range(height)]

    seeds: list[tuple[int, int]] = []
    for x in range(width):
        seeds.append((x, 0))
        seeds.append((x, height - 1))
    for y in range(height):
        seeds.append((0, y))
        seeds.append((width - 1, y))

    queue: deque[tuple[int, int]] = deque()
    for x, y in seeds:
        if visited[y][x]:
            continue
        rgb = pixels[x, y][:3]
        if not is_background_pixel(rgb, tolerance):
            continue
        visited[y][x] = True
        queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (pixels[x, y][0], pixels[x, y][1], pixels[x, y][2], 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= width or ny >= height:
                continue
            if visited[ny][nx]:
                continue
            rgb = pixels[nx, ny][:3]
            if is_background_pixel(rgb, tolerance):
                visited[ny][nx] = True
                queue.append((nx, ny))

    return rgba


def convert_file(input_path: Path, output_path: Path, tolerance: int) -> None:
    with Image.open(input_path) as image:
        result = flood_transparent(image, tolerance)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result.save(output_path, format="PNG", optimize=True)
    print(f"Wrote {output_path}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="Input JPG/PNG files")
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        help="Output directory (default: same as each input)",
    )
    parser.add_argument(
        "-t",
        "--tolerance",
        type=int,
        default=36,
        help="White fringe tolerance (default: 36)",
    )
    args = parser.parse_args(argv)

    for raw in args.inputs:
        input_path = Path(raw)
        if not input_path.exists():
            print(f"Missing: {input_path}", file=sys.stderr)
            return 1
        out_dir = args.output_dir or input_path.parent
        output_path = out_dir / f"{input_path.stem}.png"
        convert_file(input_path, output_path, args.tolerance)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))