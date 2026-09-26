/**
 * Optical proximity correction (OPC) for a binary mask at printer resolution.
 *
 * Rule-based: serifs on convex corners (add material), anti-serifs on concave corners
 * (remove material), global bias.
 *
 * Model-based: iteratively modify the mask so the simulated (blurred + thresholded)
 * image matches the design.
 */
import { binarize, cloneBitmap, createBitmap, dilate, isOn } from "./bitmap";
import type { Bitmap } from "./bitmap";
import { simulateExposure } from "./simulate";

export interface RuleOpcOptions {
    /** Side of the square added on convex corners, in pixels (0 = off). Even sizes are centred on the vertex. */
    convexSerif: number;
    /** Side of the square removed on concave corners, in pixels (0 = off). */
    concaveSerif: number;
    /** Global bias in pixels (+ widens, - narrows). Applied before serifs. */
    bias: number;
}

/**
 * Detect corners by scanning every 2x2 window. Exactly one ON pixel -> convex corner
 * (vertex between the 4 pixels); exactly three ON -> concave corner.
 */
export function applyRuleOpc(design: Bitmap, opts: RuleOpcOptions): Bitmap {
    const { width, height } = design;
    let base = binarize(design);
    if (opts.bias > 0) base = dilate(base, opts.bias);
    else if (opts.bias < 0) {
        // erode = invert(dilate(invert))
        const inv = createBitmap(width, height);
        for (let i = 0; i < inv.data.length; i++) inv.data[i] = 255 - base.data[i];
        const d = dilate(inv, -opts.bias);
        for (let i = 0; i < d.data.length; i++) base.data[i] = 255 - d.data[i];
    }

    if (opts.convexSerif <= 0 && opts.concaveSerif <= 0) return base;

    const add = createBitmap(width, height);
    const remove = createBitmap(width, height);
    const cs = Math.max(0, Math.round(opts.convexSerif));
    const ks = Math.max(0, Math.round(opts.concaveSerif));
    const d = base.data;

    for (let y = 0; y < height - 1; y++) {
        const r0 = y * width, r1 = r0 + width;
        for (let x = 0; x < width - 1; x++) {
            const a = isOn(d[r0 + x]) ? 1 : 0;
            const b = isOn(d[r0 + x + 1]) ? 1 : 0;
            const c = isOn(d[r1 + x]) ? 1 : 0;
            const e = isOn(d[r1 + x + 1]) ? 1 : 0;
            const n = a + b + c + e;
            if (n === 1 && cs > 0) {
                // vertex at (x+1, y+1) in vertex coordinates; square of side cs centred there
                stampSquare(add, x + 1, y + 1, cs);
            } else if (n === 3 && ks > 0) {
                stampSquare(remove, x + 1, y + 1, ks);
            }
        }
    }

    const out = cloneBitmap(base);
    for (let i = 0; i < out.data.length; i++) {
        if (add.data[i]) out.data[i] = 255;
        if (remove.data[i]) out.data[i] = 0;
    }
    return out;
}

/** Stamp a square of side `s` centred on vertex (vx, vy) (vertex coordinates lie between pixels). */
function stampSquare(b: Bitmap, vx: number, vy: number, s: number) {
    const half = s / 2;
    const x0 = Math.max(0, Math.floor(vx - half)), x1 = Math.min(b.width, Math.ceil(vx + half));
    const y0 = Math.max(0, Math.floor(vy - half)), y1 = Math.min(b.height, Math.ceil(vy + half));
    for (let y = y0; y < y1; y++) b.data.fill(255, y * b.width + x0, y * b.width + x1);
}

export interface ModelOpcOptions {
    /** Blur sigma in pixels. */
    sigmaPx: number;
    /** Normalised threshold (D0 / D): pixels whose blurred intensity >= threshold are cleared/cured. */
    threshold: number;
    /** Number of correction iterations. */
    iterations: number;
    /** Maximum distance (px) from the design edge where the mask may be modified. */
    band: number;
}

export interface ModelOpcResult {
    mask: Bitmap;
    /** Number of pixels that still differ between simulation and design after the last iteration. */
    residual: number;
    history: number[];
}

/**
 * Simple iterative model-based OPC:
 *   under = design AND NOT sim     -> grow the mask around these pixels
 *   over  = sim AND NOT design     -> shrink the mask at these pixels
 * Modifications are confined to a band around the design edges.
 */
export function applyModelOpc(design: Bitmap, opts: ModelOpcOptions, onProgress?: (iter: number, residual: number) => void): ModelOpcResult {
    const target = binarize(design);
    const { width, height } = target;
    const bandOuter = dilate(target, opts.band);
    const inv = createBitmap(width, height);
    for (let i = 0; i < inv.data.length; i++) inv.data[i] = 255 - target.data[i];
    const bandInnerInv = dilate(inv, opts.band); // pixels within `band` of the outside
    // allowed[i] = within band of an edge (either side)
    const allowed = new Uint8Array(width * height);
    for (let i = 0; i < allowed.length; i++) {
        allowed[i] = (bandOuter.data[i] && bandInnerInv.data[i]) ? 1 : 0;
    }

    let mask = cloneBitmap(target);
    const history: number[] = [];
    let residual = 0;
    for (let it = 0; it < opts.iterations; it++) {
        const sim = simulateExposure(mask, opts.sigmaPx, opts.threshold);
        const under = createBitmap(width, height);
        const over = createBitmap(width, height);
        residual = 0;
        for (let i = 0; i < sim.data.length; i++) {
            const t = target.data[i] >= 128, s = sim.data[i] >= 128;
            if (t && !s) { under.data[i] = 255; residual++; }
            else if (!t && s) { over.data[i] = 255; residual++; }
        }
        history.push(residual);
        if (onProgress) onProgress(it, residual);
        if (residual === 0) break;
        const grow = dilate(under, 1);
        for (let i = 0; i < mask.data.length; i++) {
            if (!allowed[i]) continue;
            if (grow.data[i]) mask.data[i] = 255;
            if (over.data[i]) mask.data[i] = 0;
        }
    }
    return { mask, residual, history };
}
