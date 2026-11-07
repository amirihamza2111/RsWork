"""
Synthesizes a 3-minute royalty-free music bed for the promo, with sound effects synced
to the animation (whooshes on scene changes, soft clicks on taps, light pops).

  python video/make_music.py video/out/events.json video/out/music.wav [duration_seconds]

events.json comes from:  blender -b -P video/rswork_promo.py -- --events video/out/events.json
"""
import json
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
DUR = float(sys.argv[3]) if len(sys.argv) > 3 else 180.0
N = int(SR * DUR)
SHORT = DUR <= 90          # the 60-second commercial: faster, punchier
BPM = 112 if SHORT else 96
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

# vi - IV - I - V in C major, two bars each
PROG = [(45, [57, 60, 64, 67]),   # Am7
        (41, [53, 57, 60, 64]),   # Fmaj7
        (48, [55, 60, 64, 67]),   # C
        (43, [55, 59, 62, 67])]   # G


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x, axis=0)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x, axis=0)


def bp(x, f0, f1, order=2):
    return sosfilt(butter(order, [f0, f1], "band", fs=SR, output="sos"), x, axis=0)


def level(points):
    """Piecewise-linear automation curve from [(t, v), ...]."""
    t = np.arange(N) / SR
    ts, vs = zip(*points)
    return np.interp(t, ts, vs)


def add(buf, start, sig):
    i = int(start * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    buf[i:j] += sig[: j - i]


def chord_at(t):
    return PROG[int(t // (2 * BAR)) % len(PROG)]


# ------------------------------------------------------------------ pad
def saw(f, n, harmonics=10):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, harmonics + 1):
        if f * k > 9000:
            break
        out += np.sin(2 * np.pi * f * k * t + k) / k
    return out


pad = np.zeros((N, 2))
seg = 2 * BAR
t0 = 0.0
while t0 < DUR:
    _, notes = chord_at(t0 + 0.01)
    n = int((seg + 1.6) * SR)
    env = np.ones(n)
    a, r = int(1.0 * SR), int(1.6 * SR)
    env[:a] = np.linspace(0, 1, a) ** 1.5
    env[-r:] = np.linspace(1, 0, r) ** 1.5
    i0 = int(t0 * SR)
    m_ = min(n, N - i0)
    for m in notes:
        for ch, cents in ((0, -8), (1, 8)):
            f = hz(m) * 2 ** (cents / 1200)
            pad[i0:i0 + m_, ch] += (saw(f, n) * env * 0.05)[:m_]
    t0 += seg
pad = lp(pad, 1500)
pad *= level([(0, 0), (1, 0.8), (4.5, 1), (DUR - 2, 1), (DUR, 0)] if SHORT else
             [(0, 0), (3, 1), (9, 0.75), (26, 0.75), (28, 1), (176, 1), (180, 0)])[:, None]

# ------------------------------------------------------------------ pluck arpeggio
pluck = np.zeros((N, 2))
step = BEAT / 2
pattern = [0, 1, 2, 3, 2, 1, 3, 2]
k = 0
t = 0.0
while t < DUR:
    _, notes = chord_at(t + 0.001)
    m = notes[pattern[k % len(pattern)]] + 12
    n = int(0.9 * SR)
    tt = np.arange(n) / SR
    f = hz(m)
    s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) + 0.1 * np.sin(6 * np.pi * f * tt))
    s *= np.exp(-tt / 0.22) * np.minimum(1, tt / 0.004) * 0.11
    pan = 0.5 + 0.3 * np.sin(k * 0.9)
    for ch, g in ((0, 1 - pan), (1, pan)):
        add(pluck[:, ch], t, s * g * 2)
    k += 1
    t += step
# dotted-eighth echo
d = int(BEAT * 0.75 * SR)
echo = np.zeros_like(pluck)
for i, g in enumerate((0.38, 0.2, 0.1), 1):
    sh = np.zeros_like(pluck)
    sh[d * i:] = pluck[:-d * i][:, ::-1] if i % 2 else pluck[:-d * i]
    echo += sh * g
pluck = lp(pluck + echo, 5000)
pluck *= level([(0, 0), (4.2, 0), (4.4, 1), (55, 1), (58, 0.6), (DUR, 0)] if SHORT else
               [(0, 0), (26, 0), (28.5, 0.85), (64, 0.85), (66, 1), (156, 1), (160, 0.7),
                (170, 0.9), (176, 0.6), (180, 0)])[:, None]

# ------------------------------------------------------------------ bass
bass = np.zeros(N)
t = 0.0
while t < DUR:
    root, _ = chord_at(t + 0.001)
    for off, dur, g in ((0, 0.9, 1.0), (1.5 * BEAT, 0.4, 0.6), (2 * BEAT, 0.9, 0.85), (3.5 * BEAT, 0.3, 0.5)):
        n = int(dur * SR)
        tt = np.arange(n) / SR
        f = hz(root)
        s = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(4 * np.pi * f * tt))
        s *= np.minimum(1, tt / 0.01) * np.exp(-tt / (dur * 0.6)) * 0.22 * g
        add(bass, t + off, s)
    t += BAR
bass = lp(bass, 400)
bass *= level([(0, 0), (6.3, 0), (6.43, 1), (57, 1), (59, 0)] if SHORT else
              [(0, 0), (38, 0), (39, 1), (172, 1), (176, 0)])

# ------------------------------------------------------------------ drums
drums = np.zeros(N)
kick_n = int(0.45 * SR)
tt = np.arange(kick_n) / SR
phase = 2 * np.pi * np.cumsum(48 + 80 * np.exp(-tt / 0.035)) / SR
kick = np.sin(phase) * np.exp(-tt / 0.18) * 0.5
hat_n = int(0.06 * SR)
hat = hp(rng.standard_normal(hat_n), 7000) * np.exp(-np.arange(hat_n) / SR / 0.012) * 0.06
clap_n = int(0.25 * SR)
clap = bp(rng.standard_normal(clap_n), 900, 3500) * np.exp(-np.arange(clap_n) / SR / 0.06) * 0.08
b = 0
t = 0.0
while t < DUR:
    beat = b % 4
    if beat in (0, 2):
        add(drums, t, kick)
    if beat in (1, 3) and t >= (21.4 if SHORT else 64):
        add(drums, t, clap)
    add(drums, t + BEAT / 2, hat)
    if t >= (41.7 if SHORT else 110):
        add(drums, t + BEAT / 4 * 3, hat * 0.5)
    b += 1
    t += BEAT
drums *= level([(0, 0), (6.3, 0), (6.43, 0.85), (50.2, 0.85), (50.36, 1), (55.6, 1), (55.71, 0), (DUR, 0)]
               if SHORT else
               [(0, 0), (37.5, 0), (38, 0.8), (157, 0.8), (158, 1.0), (169.5, 1.0), (170, 0), (180, 0)])

# ------------------------------------------------------------------ sound effects
fx = np.zeros((N, 2))
events = json.load(open(sys.argv[1]))
for s0 in events["shot"]:
    if s0 <= 0.1:
        continue
    n = int(1.4 * SR)
    noise = bp(rng.standard_normal(n), 300, 5000)
    tt = np.arange(n) / SR
    env = np.where(tt < 0.8, (tt / 0.8) ** 2.5, np.exp(-(tt - 0.8) / 0.18)) * 0.16
    pan = np.linspace(0.2, 0.8, n)
    add(fx[:, 0], s0 - 0.8, noise * env * (1 - pan))
    add(fx[:, 1], s0 - 0.8, noise * env * pan)
for t in events["tap"]:
    n = int(0.06 * SR)
    tt = np.arange(n) / SR
    s = (np.sin(2 * np.pi * 1900 * tt) + 0.6 * np.sin(2 * np.pi * 950 * tt)) * np.exp(-tt / 0.012) * 0.12
    add(fx[:, 0], t, s)
    add(fx[:, 1], t, s)
for t in events["pop"]:
    n = int(0.12 * SR)
    tt = np.arange(n) / SR
    f = 600 + 900 * np.exp(-tt / 0.02)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.03) * 0.05
    add(fx[:, 0], t, s)
    add(fx[:, 1], t, s)
for t in events.get("punch", []):     # camera punches: a short low thump
    n = int(0.3 * SR)
    tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(55 + 60 * np.exp(-tt / 0.03)) / SR) * np.exp(-tt / 0.12) * 0.22
    add(fx[:, 0], t, s)
    add(fx[:, 1], t, s)
# opening and closing hits: a soft low boom
for t in ((4.29, 55.86) if SHORT else (0.4, 170.3)):
    n = int(2.5 * SR)
    tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(38 + 40 * np.exp(-tt / 0.1)) / SR) * np.exp(-tt / 0.9) * 0.35
    add(fx[:, 0], t, s)
    add(fx[:, 1], t, s)

# ------------------------------------------------------------------ mix + reverb
wet_in = pad + pluck * 0.8 + fx * 0.3
ir_n = int(2.4 * SR)
ir_t = np.arange(ir_n) / SR
ir = rng.standard_normal((ir_n, 2)) * np.exp(-ir_t / 0.55)[:, None]
ir = lp(ir, 6000)
ir /= np.sqrt((ir ** 2).sum(axis=0))
wet = np.stack([fftconvolve(wet_in[:, c], ir[:, c])[:N] for c in range(2)], axis=1)

mix = pad + pluck + bass[:, None] + drums[:, None] + fx + 0.35 * wet
mix = hp(mix, 30)
mix = np.tanh(1.3 * mix) / np.tanh(1.3)
fade = np.ones(N)
fade[: int(0.3 * SR)] = np.linspace(0, 1, int(0.3 * SR))
fade[-int(3.0 * SR):] = np.linspace(1, 0, int(3.0 * SR)) ** 1.5
mix *= fade[:, None]
mix *= 0.79 / np.max(np.abs(mix))          # peak about -2 dBFS
wavfile.write(sys.argv[2], SR, (mix * 32767).astype(np.int16))
print("wrote", sys.argv[2], f"{DUR:.0f}s")
