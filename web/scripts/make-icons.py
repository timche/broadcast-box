"""Regenerate the PWA icons in `public/`. Run from the `web` directory:

    python3 scripts/make-icons.py

A dark rounded-square field with a white broadcast mark: a play triangle
flanked by two signal arcs, drawn at 4x and box-filtered down to antialias.
Written against the standard library alone so the icons stay reproducible
without adding an image dependency to the project.
"""
import math, struct, zlib

BG = (17, 18, 20)
FG = (250, 250, 250)
SS = 4  # supersampling factor


def inside_rounded_square(x, y, size, radius):
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def inside_triangle(x, y, size):
    # Play mark, centred, pointing right.
    left = size * 0.415
    right = size * 0.625
    half = size * 0.135
    if x < left or x > right:
        return False
    span = (x - left) / (right - left)
    reach = half * (1 - span)
    return abs(y - size / 2) <= reach


def inside_arc(x, y, size, radius_ratio, thickness_ratio):
    # Two symmetric arcs opening left and right of the play mark.
    cx, cy = size * 0.5, size * 0.5
    distance = math.hypot(x - cx, y - cy)
    radius = size * radius_ratio
    thickness = size * thickness_ratio
    if abs(distance - radius) > thickness / 2:
        return False
    angle = math.degrees(math.atan2(y - cy, x - cx))
    return abs(angle) <= 42 or abs(angle) >= 138


def render(size, maskable=False):
    big = size * SS
    # A maskable icon is full-bleed (the launcher supplies the shape) and keeps
    # its mark inside the safe circle, so nothing is clipped by a round mask.
    radius = 0 if maskable else big * 0.22
    scale = 0.72 if maskable else 1.0
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            covered = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x * SS + sx + 0.5
                    py = y * SS + sy + 0.5
                    if not inside_rounded_square(px, py, big, radius):
                        continue
                    covered += 1
                    gx = big / 2 + (px - big / 2) / scale
                    gy = big / 2 + (py - big / 2) / scale
                    mark = (
                        inside_triangle(gx, gy, big)
                        or inside_arc(gx, gy, big, 0.30, 0.045)
                        or inside_arc(gx, gy, big, 0.40, 0.045)
                    )
                    colour = FG if mark else BG
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
            samples = SS * SS
            alpha = round(255 * covered / samples)
            if covered == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((round(r / covered), round(g / covered), round(b / covered), alpha))
        rows.append(bytes(row))
    return rows


def write_png(path, size, maskable=False):
    rows = render(size, maskable)
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)
    print(path, size, "->", len(png), "bytes")


for size in (192, 512):
    write_png(f"public/icon-{size}.png", size)
write_png("public/icon-maskable-512.png", 512, maskable=True)
