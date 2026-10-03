"""生成心事站内置的三首环境音（纯合成，无版权问题）。
用法：python server/scripts/generate_audio.py
输出：server/uploads/audio/*.wav
"""
import math
import os
import random
import struct
import wave

SR = 22050
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(HERE, "..", "uploads", "audio"))


def write_wav(name, samples):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        payload = bytearray()
        for value in samples:
            clamped = max(-1.0, min(1.0, value))
            payload += struct.pack("<h", int(clamped * 31000))
        handle.writeframes(bytes(payload))
    print("wrote", path, f"{os.path.getsize(path) / 1024 / 1024:.2f} MB")


def fade(index, total, seconds=3.0):
    edge = int(SR * seconds)
    if index < edge:
        return index / edge
    if index > total - edge:
        return (total - index) / edge
    return 1.0


def track_night_voyage(duration=48.0):
    total = int(SR * duration)
    chord = [110.0, 130.81, 164.81, 220.0]
    lfos = [0.041, 0.053, 0.067, 0.079]
    out = []
    for i in range(total):
        t = i / SR
        sample = 0.0
        for freq, lfo in zip(chord, lfos):
            swell = 0.5 + 0.5 * math.sin(2 * math.pi * lfo * t - math.pi / 2)
            env = 0.25 + 0.75 * swell
            sample += env * (
                math.sin(2 * math.pi * freq * t)
                + 0.28 * math.sin(2 * math.pi * freq * 2 * t)
                + 0.12 * math.sin(2 * math.pi * freq * 3 * t)
            )
        sample *= 0.09 * fade(i, total)
        out.append(sample)
    return out


def track_moss_trace(duration=46.0):
    total = int(SR * duration)
    rng = random.Random(20260925)
    scale = [293.66, 329.63, 349.23, 440.0, 523.25, 587.33]
    notes = []
    cursor = 0.6
    while cursor < duration - 3.0:
        notes.append((cursor, rng.choice(scale) * (0.5 if rng.random() < 0.3 else 1.0), rng.uniform(2.2, 4.2)))
        cursor += rng.uniform(1.1, 2.6)

    drone = []
    for i in range(total):
        t = i / SR
        drone.append(
            0.05
            * (math.sin(2 * math.pi * 82.41 * t) + 0.3 * math.sin(2 * math.pi * 123.47 * t))
        )

    out = list(drone)
    for start, freq, decay in notes:
        begin = int(start * SR)
        length = int(decay * SR)
        for k in range(length):
            index = begin + k
            if index >= total:
                break
            local = k / SR
            env = math.exp(-local * (3.2 / decay))
            value = (
                math.sin(2 * math.pi * freq * local)
                + 0.22 * math.sin(2 * math.pi * freq * 2.01 * local)
                + 0.08 * math.sin(2 * math.pi * freq * 3.02 * local)
            )
            out[index] += 0.13 * env * value

    return [out[i] * fade(i, total) for i in range(total)]


def track_tide_notes(duration=50.0):
    total = int(SR * duration)
    rng = random.Random(770425)
    out = []
    previous = 0.0
    for i in range(total):
        t = i / SR
        noise = rng.uniform(-1.0, 1.0)
        cutoff = 0.012 + 0.01 * (0.5 + 0.5 * math.sin(2 * math.pi * 0.031 * t))
        previous = previous + cutoff * (noise - previous)
        wash = previous * 3.4 * (0.45 + 0.55 * math.sin(2 * math.pi * 0.047 * t) ** 2)
        drone = 0.06 * math.sin(2 * math.pi * 65.41 * t) + 0.03 * math.sin(2 * math.pi * 98.0 * t)
        out.append((wash + drone) * 0.6)

    for start in (6.0, 14.5, 23.0, 31.5, 40.0):
        freq = rng.choice([392.0, 466.16, 523.25, 587.33])
        begin = int(start * SR)
        length = int(3.4 * SR)
        for k in range(length):
            index = begin + k
            if index >= total:
                break
            local = k / SR
            out[index] += 0.1 * math.exp(-local * 1.1) * math.sin(2 * math.pi * freq * local)

    return [out[i] * fade(i, total) for i in range(total)]


if __name__ == "__main__":
    write_wav("night-voyage.wav", track_night_voyage())
    write_wav("moss-trace.wav", track_moss_trace())
    write_wav("tide-notes.wav", track_tide_notes())