"""生成演示用的抽象配图（纯计算生成，无版权问题）。
用法：python server/scripts/generate_images.py
输出：server/uploads/images/seed-*.png
"""
import math
import os
import random
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(HERE, "..", "uploads", "images"))
W, H = 720, 480


def write_png(path, pixels):
    raw = b"".join(b"\x00" + pixels[y * W * 3:(y + 1) * W * 3] for y in range(H))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)))
        handle.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        handle.write(chunk(b"IEND", b""))
    print("wrote", path)


def blend(base, top, alpha):
    return tuple(int(base[i] * (1 - alpha) + top[i] * alpha) for i in range(3))


def render(name, bg, blobs, grain=7.0, seed=1):
    rng = random.Random(seed)
    pixels = bytearray()
    for y in range(H):
        for x in range(W):
            color = bg
            for (cx, cy, radius, tint) in blobs:
                distance = math.hypot(x - cx, y - cy)
                weight = max(0.0, 1.0 - distance / radius)
                color = blend(color, tint, weight ** 2 * 0.85)
            noise = rng.uniform(-grain, grain)
            pixels += bytes(
                max(0, min(255, int(channel + noise))) for channel in color
            )
    write_png(os.path.join(OUT_DIR, name), bytes(pixels))


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    render(
        "seed-1.png",
        (18, 24, 38),
        [(180, 140, 320, (107, 163, 240)), (560, 360, 300, (79, 184, 174))],
        seed=11,
    )
    render(
        "seed-2.png",
        (26, 22, 30),
        [(600, 120, 340, (217, 160, 91)), (200, 400, 280, (217, 140, 147))],
        seed=23,
    )
    render(
        "seed-3.png",
        (16, 26, 28),
        [(360, 240, 420, (143, 191, 127)), (140, 100, 200, (147, 165, 184))],
        seed=37,
    )
    render(
        "seed-4.png",
        (20, 22, 34),
        [(120, 380, 300, (138, 143, 224)), (620, 200, 260, (214, 180, 92))],
        seed=53,
    )