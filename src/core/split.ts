/**
 * Double patterning: split a mask into two masks A and B so that no two features closer
 * than `minDistance` pixels end up in the same mask. Intended for a
 * expose -> develop -> etch/harden -> recoat -> expose flow (LELE).
 *
 * Also provides alignment marks shared by both masks.
 */
import { binarize, createBitmap, fillRect, labelComponents } from "./bitmap";
import type { Bitmap } from "./bitmap";

export interface SplitResult {
    a: Bitmap;
    b: Bitmap;
    /** Number of components assigned to each mask. */
    countA: number;
    countB: number;
    /** Components that could not be 2-coloured (odd cycle in the conflict graph). They stay in A. */
    conflicts: number;
}

export function splitMask(design: Bitmap, minDistance: number): SplitResult {
    const bin = binarize(design);
    const { width, height } = bin;
    const { labels, components } = labelComponents(bin);
    const n = components.length;
    const adj: Set<number>[] = Array.from({ length: n + 1 }, () => new Set<number>());
    const d = Math.max(1, Math.round(minDistance));

    // Build conflict graph: check boundary pixels' neighbourhood of radius d
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            const l = labels[p];
            if (l === 0) continue;
            // boundary pixel?
            const boundary =
                x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
                labels[p - 1] !== l || labels[p + 1] !== l || labels[p - width] !== l || labels[p + width] !== l;
            if (!boundary) continue;
            const y0 = Math.max(0, y - d), y1 = Math.min(height - 1, y + d);
            const x0 = Math.max(0, x - d), x1 = Math.min(width - 1, x + d);
            for (let yy = y0; yy <= y1; yy++) {
                const row = yy * width;
                for (let xx = x0; xx <= x1; xx++) {
                    const m = labels[row + xx];
                    if (m !== 0 && m !== l) { adj[l].add(m); adj[m].add(l); }
                }
            }
        }
    }

    // 2-colour by BFS
    const colour = new Int8Array(n + 1).fill(-1);
    let conflicts = 0;
    for (let s = 1; s <= n; s++) {
        if (colour[s] !== -1) continue;
        colour[s] = 0;
        const queue: number[] = [s];
        while (queue.length) {
            const u = queue.shift()!;
            const neighbours = Array.from(adj[u]);
            for (let k = 0; k < neighbours.length; k++) {
                const v = neighbours[k];
                if (colour[v] === -1) { colour[v] = 1 - colour[u]; queue.push(v); }
                else if (colour[v] === colour[u]) conflicts++;
            }
        }
    }

    const a = createBitmap(width, height), b = createBitmap(width, height);
    for (let i = 0; i < labels.length; i++) {
        const l = labels[i];
        if (l === 0) continue;
        if (colour[l] === 1) b.data[i] = 255; else a.data[i] = 255;
    }
    let countA = 0, countB = 0;
    for (let l = 1; l <= n; l++) { if (colour[l] === 1) countB++; else countA++; }
    return { a, b, countA, countB, conflicts: Math.floor(conflicts / 2) };
}

export interface AlignmentMarkOptions {
    /** Cross arm length (px). */
    size: number;
    /** Line width (px). */
    lineWidth: number;
    /** Distance from the field corner to the mark centre (px). */
    inset: number;
    /** Which corners get a mark. */
    corners: { tl: boolean, tr: boolean, bl: boolean, br: boolean };
}

/** Draw a cross centred at (cx, cy). */
export function drawCross(b: Bitmap, cx: number, cy: number, size: number, lineWidth: number): void {
    const half = Math.floor(size / 2), lw = Math.max(1, Math.round(lineWidth));
    fillRect(b, cx - half, cy - Math.floor(lw / 2), size, lw);
    fillRect(b, cx - Math.floor(lw / 2), cy - half, lw, size);
}

/** Draw a hollow square (box) centred at (cx, cy). Used as the second half of a box-in-cross mark. */
export function drawBox(b: Bitmap, cx: number, cy: number, size: number, lineWidth: number): void {
    const half = Math.floor(size / 2), lw = Math.max(1, Math.round(lineWidth));
    fillRect(b, cx - half, cy - half, size, lw);
    fillRect(b, cx - half, cy + half - lw, size, lw);
    fillRect(b, cx - half, cy - half, lw, size);
    fillRect(b, cx + half - lw, cy - half, lw, size);
}

/**
 * Alignment marks around a field (x0,y0)-(x1,y1) in pixels.
 * Mask A gets crosses; mask B gets boxes that frame the crosses, so overlay error is visible.
 */
export function alignmentMarks(width: number, height: number, field: { x0: number, y0: number, x1: number, y1: number }, opts: AlignmentMarkOptions): { a: Bitmap, b: Bitmap, both: Bitmap } {
    const a = createBitmap(width, height), b = createBitmap(width, height), both = createBitmap(width, height);
    const centres: [number, number][] = [];
    if (opts.corners.tl) centres.push([field.x0 - opts.inset, field.y0 - opts.inset]);
    if (opts.corners.tr) centres.push([field.x1 + opts.inset, field.y0 - opts.inset]);
    if (opts.corners.bl) centres.push([field.x0 - opts.inset, field.y1 + opts.inset]);
    if (opts.corners.br) centres.push([field.x1 + opts.inset, field.y1 + opts.inset]);
    for (const [cx, cy] of centres) {
        drawCross(a, cx, cy, opts.size, opts.lineWidth);
        drawBox(b, cx, cy, opts.size + 4 * opts.lineWidth, opts.lineWidth);
        drawCross(both, cx, cy, opts.size, opts.lineWidth);
        drawBox(both, cx, cy, opts.size + 4 * opts.lineWidth, opts.lineWidth);
    }
    return { a, b, both };
}
