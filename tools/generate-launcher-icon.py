#!/usr/bin/env python3
"""Generate the Windows ICO from the codexhost-light SVG geometry.

The SVG is the canonical product artwork. Windows executable resources need an
ICO container, so this small dependency-free rasterizer keeps that conversion
deterministic without introducing a bitmap asset into the product source.
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "crates/launcher/assets/codexhost.ico"
SIZES = (16, 24, 32, 48, 64, 128, 256)
SCALE = 4


def clamp(value: float) -> int:
    return max(0, min(255, round(value)))


def mix(left: tuple[int, int, int], right: tuple[int, int, int], amount: float):
    return tuple(clamp(a + (b - a) * amount) for a, b in zip(left, right))


def distance_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if length == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def polygon_edges(points):
    return list(zip(points, points[1:] + points[:1]))


def inside_polygon(x: float, y: float, points) -> bool:
    inside = False
    for (ax, ay), (bx, by) in polygon_edges(points):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def stroke_alpha(x: float, y: float, points, width: float) -> float:
    distance = min(distance_to_segment(x, y, *a, *b) for a, b in polygon_edges(points))
    return max(0.0, min(1.0, width / 2 + 0.9 - distance))


def rounded_rect_alpha(x: float, y: float, left: float, top: float, right: float, bottom: float, radius: float) -> float:
    cx = max(left + radius, min(x, right - radius))
    cy = max(top + radius, min(y, bottom - radius))
    distance = math.hypot(x - cx, y - cy) - radius
    return max(0.0, min(1.0, 0.9 - distance))


def render(size: int) -> bytes:
    high = size * SCALE
    pixels = []
    outer = [(128 + 86 * math.cos(math.radians(-90 + i * 60)), 128 + 98 * math.sin(math.radians(-90 + i * 60))) for i in range(6)]
    inner = [(128 + 44 * math.cos(math.radians(-90 + i * 60)), 128 + 51 * math.sin(math.radians(-90 + i * 60))) for i in range(6)]
    for y in range(high):
        for x in range(high):
            px, py = (x + 0.5) / SCALE, (y + 0.5) / SCALE
            surface = rounded_rect_alpha(px, py, 8, 8, 248, 248, 56)
            t = (px + py) / 512
            base = mix((27, 33, 64), (13, 18, 38), t)
            outer_a = stroke_alpha(px, py, outer, 14)
            inner_a = stroke_alpha(px, py, inner, 14)
            central = inside_polygon(px, py, [(128, 109), (145, 119), (145, 139), (128, 149), (111, 139), (111, 119)])
            dot = math.hypot(px - 209, py - 64) <= 8
            color = base
            if outer_a:
                color = mix(color, (245, 247, 255), outer_a * (1 - t))
            if inner_a:
                color = mix(color, (126, 145, 255), inner_a)
            if central:
                color = (248, 250, 255)
            if dot:
                color = (110, 231, 249)
            alpha = clamp(surface * 255)
            pixels.append((color[2], color[1], color[0], alpha))
    reduced = []
    for y in range(size):
        for x in range(size):
            block = [pixels[(y * SCALE + sy) * high + x * SCALE + sx] for sy in range(SCALE) for sx in range(SCALE)]
            reduced.append(tuple(sum(pixel[channel] for pixel in block) // len(block) for channel in range(4)))
    dib = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, size * size * 4, 0, 0, 0, 0)
    rows = b"".join(bytes(reduced[y * size + x]) for y in range(size - 1, -1, -1))
    return dib + rows


images = [render(size) for size in SIZES]
header = struct.pack("<HHH", 0, 1, len(images))
entries = []
offset = 6 + 16 * len(images)
payload = []
for size, image in zip(SIZES, images):
    header += struct.pack("<BBBBHHII", size if size < 256 else 0, size if size < 256 else 0, 0, 0, 1, 32, len(image), offset)
    payload.append(image)
    offset += len(image)
OUTPUT.write_bytes(header + b"".join(payload))
print(f"wrote {OUTPUT} from codexhost-light.svg")
