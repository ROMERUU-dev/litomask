/**
 * Exposure simulation (Gaussian blur + threshold) and calibration fitting.
 *
 * Model: aerial image I(x,y) = mask ⊗ G(sigma); the resist clears (positive) or
 * crosslinks (negative) where D * I >= D0, i.e. I >= D0/D = threshold.
 */
import { createBitmap } from "./bitmap";
import type { Bitmap } from "./bitmap";

/** Separable Gaussian blur on a binary/grey bitmap. Returns Float32Array of intensities in [0,1]. */
export function gaussianBlur(b: Bitmap, sigmaPx: number): Float32Array {
    const { width, height } = b;
    const n = width * height;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = b.data[i] / 255;
    if (sigmaPx <= 0) return src;

    const radius = Math.max(1, Math.ceil(sigmaPx * 3));
    const kernel = new Float32Array(radius * 2 + 1);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
        const v = Math.exp(-(i * i) / (2 * sigmaPx * sigmaPx));
        kernel[i + radius] = v;
        sum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

    const tmp = new Float32Array(n);
    // horizontal
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            let acc = 0;
            const kx0 = Math.max(-radius, -x), kx1 = Math.min(radius, width - 1 - x);
            for (let k = kx0; k <= kx1; k++) acc += src[row + x + k] * kernel[k + radius];
            tmp[row + x] = acc;
        }
    }
    const out = new Float32Array(n);
    // vertical
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let acc = 0;
            const ky0 = Math.max(-radius, -y), ky1 = Math.min(radius, height - 1 - y);
            for (let k = ky0; k <= ky1; k++) acc += tmp[(y + k) * width + x] * kernel[k + radius];
            out[y * width + x] = acc;
        }
    }
    return out;
}

/** Blur + threshold -> predicted pattern in the resist (ON = receives >= D0). */
export function simulateExposure(mask: Bitmap, sigmaPx: number, threshold: number): Bitmap {
    const I = gaussianBlur(mask, sigmaPx);
    const out = createBitmap(mask.width, mask.height);
    for (let i = 0; i < I.length; i++) out.data[i] = I[i] >= threshold ? 255 : 0;
    return out;
}

/** Blur only, returned as an 8-bit bitmap (for display). */
export function aerialImage(mask: Bitmap, sigmaPx: number): Bitmap {
    const I = gaussianBlur(mask, sigmaPx);
    const out = createBitmap(mask.width, mask.height);
    for (let i = 0; i < I.length; i++) out.data[i] = Math.round(Math.min(1, Math.max(0, I[i])) * 255);
    return out;
}

// ---------------------------------------------------------------------------
// Calibration: fit sigma and D0 from measured widths vs dose
// ---------------------------------------------------------------------------

/** Inverse error function (Giles, 2012 single-precision approximation, refined with one Newton step). */
export function erfinv(x: number): number {
    if (x <= -1) return -Infinity;
    if (x >= 1) return Infinity;
    let w = -Math.log((1 - x) * (1 + x));
    let p: number;
    if (w < 5) {
        w = w - 2.5;
        p = 2.81022636e-08;
        p = 3.43273939e-07 + p * w;
        p = -3.5233877e-06 + p * w;
        p = -4.39150654e-06 + p * w;
        p = 0.00021858087 + p * w;
        p = -0.00125372503 + p * w;
        p = -0.00417768164 + p * w;
        p = 0.246640727 + p * w;
        p = 1.50140941 + p * w;
    } else {
        w = Math.sqrt(w) - 3;
        p = -0.000200214257;
        p = 0.000100950558 + p * w;
        p = 0.00134934322 + p * w;
        p = -0.00367342844 + p * w;
        p = 0.00573950773 + p * w;
        p = -0.0076224613 + p * w;
        p = 0.00943887047 + p * w;
        p = 1.00167406 + p * w;
        p = 2.83297682 + p * w;
    }
    let y = p * x;
    // one Newton refinement: f(y) = erf(y) - x
    const e = erf(y) - x;
    y -= e / (2 / Math.sqrt(Math.PI) * Math.exp(-y * y));
    return y;
}

/** Error function (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7). */
export function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
}

export interface CalibrationPoint {
    /** Dose (any consistent unit, e.g. seconds of exposure). */
    dose: number;
    /** Measured printed width (same length unit as `nominalWidth`, e.g. µm). */
    width: number;
}

export interface CalibrationFit {
    /** Blur sigma, in the same length unit as the widths. */
    sigma: number;
    /** Dose-to-clear D0 (dose units). */
    d0: number;
    /** RMS residual of the fit. */
    rms: number;
    /** Predicted widths for the input doses. */
    predicted: number[];
}

/**
 * Model of a wide feature of nominal width w0 exposed with dose D:
 *     w(D) = w0 + 2·sigma·sqrt(2)·erfinv(1 - 2·D0/D)      (D > D0)
 * For a positive resist, "width" is the width of the cleared region of a nominally exposed
 * feature; the sign convention is identical for negative resist (crosslinked line width).
 * Grid search over D0, closed-form least squares for sigma.
 */
export function fitCalibration(points: CalibrationPoint[], nominalWidth: number): CalibrationFit | null {
    const pts = points.filter(p => p.dose > 0 && isFinite(p.width));
    if (pts.length < 2) return null;
    const minDose = Math.min(...pts.map(p => p.dose));

    let best: CalibrationFit | null = null;
    const evaluate = (d0: number): CalibrationFit => {
        let num = 0, den = 0;
        const a: number[] = pts.map(p => 2 * Math.SQRT2 * erfinv(1 - 2 * d0 / p.dose));
        for (let i = 0; i < pts.length; i++) {
            num += a[i] * (pts[i].width - nominalWidth);
            den += a[i] * a[i];
        }
        const sigma = den > 0 ? num / den : 0;
        const predicted = a.map(ai => nominalWidth + sigma * ai);
        let ss = 0;
        for (let i = 0; i < pts.length; i++) ss += (predicted[i] - pts[i].width) ** 2;
        return { sigma, d0, rms: Math.sqrt(ss / pts.length), predicted };
    };

    // coarse grid, then refine
    let lo = minDose * 0.01, hi = minDose * 0.999;
    for (let pass = 0; pass < 4; pass++) {
        const steps = 200;
        let bestLocal: CalibrationFit | null = null;
        for (let s = 0; s <= steps; s++) {
            const d0 = lo + (hi - lo) * s / steps;
            const f = evaluate(d0);
            if (f.sigma < 0) continue;
            if (!bestLocal || f.rms < bestLocal.rms) bestLocal = f;
        }
        if (!bestLocal) break;
        best = bestLocal;
        const span = (hi - lo) / steps * 4;
        lo = Math.max(minDose * 0.001, best.d0 - span);
        hi = Math.min(minDose * 0.9999, best.d0 + span);
    }
    return best;
}

/** Predicted printed width for the model above. */
export function predictWidth(nominalWidth: number, sigma: number, d0: number, dose: number): number {
    if (dose <= d0) return 0;
    return nominalWidth + 2 * Math.SQRT2 * sigma * erfinv(1 - 2 * d0 / dose);
}
