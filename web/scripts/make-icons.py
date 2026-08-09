"""Regenerate the favicon and PWA icons from `icon-source.png`.

Run from the `web` directory:

    python3 scripts/make-icons.py

Written against the standard library alone — decoding, scaling and encoding
PNG included — so the icons stay reproducible without adding an image
dependency to the project.
"""

import struct
import zlib

SOURCE = "scripts/icon-source.png"

# 32 for the favicon, 64 for the header mark, 180 for iOS home screens,
# 192 and 512 for the manifest.
SIZES = (32, 64, 180, 192, 512)

# Android masks a maskable icon to an arbitrary shape and only guarantees the
# centre 80%. The artwork is full-bleed, so it is inset onto a matching
# background rather than letting a circle crop the TV out of frame.
MASKABLE_SIZE = 512
MASKABLE_INSET = 0.8

# The whole scene turns to mush at favicon size, so the 32px icon is cropped to
# the frog's face — (left, top, side) as fractions of the source.
FAVICON_CROP = (0.17, 0.12, 0.45)


def decode_png(path):
    """Decode an 8-bit non-interlaced RGB/RGBA PNG into (width, height, RGBA)."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")

    width, height, depth, colour, _compression, _filter, interlace = struct.unpack(
        ">IIBBBBB", data[16:29]
    )
    if depth != 8 or colour not in (2, 6) or interlace != 0:
        raise ValueError(f"{path}: only 8-bit non-interlaced RGB/RGBA is supported")

    compressed = b""
    position = 8
    while position < len(data):
        length = struct.unpack(">I", data[position : position + 4])[0]
        tag = data[position + 4 : position + 8]
        if tag == b"IDAT":
            compressed += data[position + 8 : position + 8 + length]
        position += 12 + length

    raw = zlib.decompress(compressed)
    channels = 3 if colour == 2 else 4
    stride = width * channels

    pixels = bytearray(width * height * 4)
    previous = bytearray(stride)
    offset = 0
    for y in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset : offset + stride])
        offset += stride
        unfilter(filter_type, line, previous, channels)

        row = y * width * 4
        if channels == 4:
            pixels[row : row + stride] = line
        else:
            for x in range(width):
                pixels[row + x * 4 : row + x * 4 + 3] = line[x * 3 : x * 3 + 3]
                pixels[row + x * 4 + 3] = 255
        previous = line

    return width, height, pixels


def unfilter(filter_type, line, previous, channels):
    if filter_type == 0:
        return
    for index in range(len(line)):
        left = line[index - channels] if index >= channels else 0
        up = previous[index]
        if filter_type == 1:
            line[index] = (line[index] + left) & 0xFF
        elif filter_type == 2:
            line[index] = (line[index] + up) & 0xFF
        elif filter_type == 3:
            line[index] = (line[index] + ((left + up) >> 1)) & 0xFF
        elif filter_type == 4:
            upper_left = previous[index - channels] if index >= channels else 0
            line[index] = (line[index] + paeth(left, up, upper_left)) & 0xFF
        else:
            raise ValueError(f"unknown filter type {filter_type}")


def paeth(left, up, upper_left):
    estimate = left + up - upper_left
    distance_left = abs(estimate - left)
    distance_up = abs(estimate - up)
    distance_upper_left = abs(estimate - upper_left)
    if distance_left <= distance_up and distance_left <= distance_upper_left:
        return left
    if distance_up <= distance_upper_left:
        return up
    return upper_left


def resize(pixels, width, height, target):
    """Box-filter down to target x target: every output pixel averages the
    source rectangle it covers, which is what keeps the small sizes readable."""
    out = bytearray(target * target * 4)
    for y in range(target):
        y0 = y * height // target
        y1 = max(y0 + 1, (y + 1) * height // target)
        for x in range(target):
            x0 = x * width // target
            x1 = max(x0 + 1, (x + 1) * width // target)

            r = g = b = a = 0
            count = 0
            for sy in range(y0, y1):
                base = (sy * width + x0) * 4
                for _sx in range(x0, x1):
                    r += pixels[base]
                    g += pixels[base + 1]
                    b += pixels[base + 2]
                    a += pixels[base + 3]
                    base += 4
                    count += 1

            index = (y * target + x) * 4
            out[index] = r // count
            out[index + 1] = g // count
            out[index + 2] = b // count
            out[index + 3] = a // count
    return out


def crop_square(pixels, size, box):
    left_fraction, top_fraction, side_fraction = box
    left = int(size * left_fraction)
    top = int(size * top_fraction)
    side = int(size * side_fraction)

    out = bytearray()
    for y in range(top, top + side):
        start = (y * size + left) * 4
        out += pixels[start : start + side * 4]
    return out, side


def border_colour(pixels, size):
    """Average of the outermost ring, so the maskable padding blends into the
    artwork instead of framing it."""
    r = g = b = 0
    count = 0
    for x in range(size):
        for y in (0, size - 1):
            index = (y * size + x) * 4
            r += pixels[index]
            g += pixels[index + 1]
            b += pixels[index + 2]
            count += 1
    return (r // count, g // count, b // count, 255)


def inset_onto_background(pixels, size, inset):
    inner = int(size * inset)
    scaled = resize(pixels, size, size, inner)
    background = border_colour(pixels, size)

    out = bytearray()
    for _ in range(size * size):
        out += bytes(background)

    origin = (size - inner) // 2
    for y in range(inner):
        source = y * inner * 4
        target = ((y + origin) * size + origin) * 4
        out[target : target + inner * 4] = scaled[source : source + inner * 4]
    return out


def encode_png(pixels, size):
    stride = size * 4
    raw = bytearray()
    previous = bytearray(stride)
    for y in range(size):
        line = pixels[y * stride : (y + 1) * stride]
        # Filtering each row up (type 2) costs one pass and compresses this
        # artwork far better than storing it raw.
        filtered = bytearray(stride)
        for index in range(stride):
            filtered[index] = (line[index] - previous[index]) & 0xFF
        raw += b"\x02" + filtered
        previous = line

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    return png


def write(path, data):
    with open(path, "wb") as handle:
        handle.write(data)
    print(f"{path} -> {len(data)} bytes")


def write_ico(path, png):
    """ICO wrapping a single PNG frame, which every browser in use reads."""
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png), len(header) + 16)
    write(path, header + entry + png)


width, height, source = decode_png(SOURCE)
if width != height:
    raise ValueError(f"{SOURCE} must be square, got {width}x{height}")

for size in SIZES:
    if size == 32:
        face, face_size = crop_square(source, width, FAVICON_CROP)
        scaled = resize(face, face_size, face_size, size)
    else:
        scaled = source if size == width else resize(source, width, height, size)

    write(f"public/icon-{size}.png", encode_png(scaled, size))
    if size == 32:
        write_ico("public/favicon.ico", encode_png(scaled, size))

maskable = inset_onto_background(
    resize(source, width, height, MASKABLE_SIZE), MASKABLE_SIZE, MASKABLE_INSET
)
write(f"public/icon-maskable-{MASKABLE_SIZE}.png", encode_png(maskable, MASKABLE_SIZE))
