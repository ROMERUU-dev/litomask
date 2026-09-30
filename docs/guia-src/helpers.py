"""Small numeric helpers so the figure script does not need SciPy."""
import numpy as np
from math import erf


def gaussian_blur2d(a, sigma):
    r = int(3 * sigma)
    k = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * sigma ** 2))
    k /= k.sum()
    tmp = np.apply_along_axis(lambda row: np.convolve(row, k, mode="same"), 1, a)
    return np.apply_along_axis(lambda col: np.convolve(col, k, mode="same"), 0, tmp)


def erfinv(y):
    y = np.asarray(y, float)
    out = np.empty_like(y)
    for i, v in np.ndenumerate(y):
        lo, hi = -6.0, 6.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if erf(mid) < v:
                lo = mid
            else:
                hi = mid
        out[i] = (lo + hi) / 2
    return out


GLYPH_F = ["111", "100", "111", "100", "100"]


def render_F(scale=8, pad=2):
    a = np.zeros((5 * scale + 2 * pad * scale, 3 * scale + 2 * pad * scale), np.uint8)
    for r, row in enumerate(GLYPH_F):
        for c, ch in enumerate(row):
            if ch == "1":
                y = (r + pad) * scale
                x = (c + pad) * scale
                a[y:y + scale, x:x + scale] = 255
    return a
