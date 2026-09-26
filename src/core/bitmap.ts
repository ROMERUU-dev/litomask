/**
 * Binary/greyscale bitmap utilities at printer resolution.
 * Bitmaps are row-major Uint8Array, 0 = dark (not exposed), 255 = exposed.
 * "Binary" functions treat any value >= 128 as ON.
 */

export interface Bitmap {
    width: number;
    height: number;
    data: Uint8Array;
}

export function createBitmap(width: number, height: number, fill = 0): Bitmap {
    const data = new Uint8Array(width * height);
    if (fill) data.fill(fill);
    return { width, height, data };
}

export function cloneBitmap(b: Bitmap): Bitmap {
    return { width: b.width, height: b.height, data: new Uint8Array(b.data) };
}

export function isOn(v: number): boolean { return v >= 128; }

export function binarize(b: Bitmap, threshold = 128): Bitmap {
    const out = createBitmap(b.width, b.height);
    for (let i = 0; i < b.data.length; i++) out.data[i] = b.data[i] >= threshold ? 255 : 0;
    return out;
}

export function invert(b: Bitmap): Bitmap {
    const out = createBitmap(b.width, b.height);
    for (let i = 0; i < b.data.length; i++) out.data[i] = 255 - b.data[i];
    return out;
}

export function or(a: Bitmap, b: Bitmap): Bitmap {
    const out = createBitmap(a.width, a.height);
    for (let i = 0; i < a.data.length; i++) out.data[i] = Math.max(a.data[i], b.data[i]);
    return out;
}

export function and(a: Bitmap, b: Bitmap): Bitmap {
    const out = createBitmap(a.width, a.height);
    for (let i = 0; i < a.data.length; i++) out.data[i] = Math.min(a.data[i], b.data[i]);
    return out;
}

/** a AND NOT b */
export function andNot(a: Bitmap, b: Bitmap): Bitmap {
    const out = createBitmap(a.width, a.height);
    for (let i = 0; i < a.data.length; i++) out.data[i] = isOn(b.data[i]) ? 0 : a.data[i];
    return out;
}

export function countOn(b: Bitmap): number {
    let n = 0;
    for (let i = 0; i < b.data.length; i++) if (b.data[i] >= 128) n++;
    return n;
}

export function fillRect(b: Bitmap, x: number, y: number, w: number, h: number, value = 255): void {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(b.width, Math.floor(x + w)), y1 = Math.min(b.height, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) {
        b.data.fill(value, yy * b.width + x0, yy * b.width + x1);
    }
}

/** Copy `src` into `dst` at (x, y) with OR semantics (src ON pixels set dst). */
export function blit(dst: Bitmap, src: Bitmap, x: number, y: number): void {
    for (let sy = 0; sy < src.height; sy++) {
        const dy = y + sy;
        if (dy < 0 || dy >= dst.height) continue;
        for (let sx = 0; sx < src.width; sx++) {
            const dx = x + sx;
            if (dx < 0 || dx >= dst.width) continue;
            const v = src.data[sy * src.width + sx];
            if (v) dst.data[dy * dst.width + dx] = Math.max(dst.data[dy * dst.width + dx], v);
        }
    }
}

/**
 * Morphological dilation with a square structuring element of radius r (side 2r+1).
 * Implemented as two 1-D max filters (separable), O(N) per pass using a sliding window
 * on binary data (any ON within the window -> ON).
 */
export function dilate(b: Bitmap, r: number): Bitmap {
    if (r <= 0) return cloneBitmap(b);
    const { width, height } = b;
    const tmp = createBitmap(width, height);
    // horizontal pass
    for (let y = 0; y < height; y++) {
        const row = y * width;
        let count = 0; // number of ON pixels inside window [x-r, x+r]
        for (let x = -r; x < width; x++) {
            const enter = x + r;
            const leave = x - r - 1;
            if (enter < width && enter >= 0 && b.data[row + enter] >= 128) count++;
            if (leave >= 0 && b.data[row + leave] >= 128) count--;
            if (x >= 0) tmp.data[row + x] = count > 0 ? 255 : 0;
        }
    }
    const out = createBitmap(width, height);
    // vertical pass
    for (let x = 0; x < width; x++) {
        let count = 0;
        for (let y = -r; y < height; y++) {
            const enter = y + r;
            const leave = y - r - 1;
            if (enter < height && enter >= 0 && tmp.data[enter * width + x] >= 128) count++;
            if (leave >= 0 && tmp.data[leave * width + x] >= 128) count--;
            if (y >= 0) out.data[y * width + x] = count > 0 ? 255 : 0;
        }
    }
    return out;
}

/** Morphological erosion with a square structuring element of radius r. */
export function erode(b: Bitmap, r: number): Bitmap {
    if (r <= 0) return cloneBitmap(b);
    return invert(dilate(invert(binarize(b)), r));
}

/** Signed bias: positive dilates (wider features), negative erodes. */
export function bias(b: Bitmap, px: number): Bitmap {
    if (px > 0) return dilate(b, px);
    if (px < 0) return erode(b, -px);
    return cloneBitmap(b);
}

/**
 * Connected-component labelling (4-connectivity). Returns labels (0 = background, 1..n)
 * and per-component bounding boxes.
 */
export interface Component { label: number; x0: number; y0: number; x1: number; y1: number; pixels: number; }

export function labelComponents(b: Bitmap): { labels: Int32Array, components: Component[] } {
    const { width, height, data } = b;
    const labels = new Int32Array(width * height);
    const components: Component[] = [];
    const stack = new Int32Array(width * height);
    let next = 1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < 128 || labels[i] !== 0) continue;
        const label = next++;
        const comp: Component = { label, x0: width, y0: height, x1: -1, y1: -1, pixels: 0 };
        let sp = 0;
        stack[sp++] = i;
        labels[i] = label;
        while (sp > 0) {
            const p = stack[--sp];
            const x = p % width, y = (p - x) / width;
            comp.pixels++;
            if (x < comp.x0) comp.x0 = x;
            if (x > comp.x1) comp.x1 = x;
            if (y < comp.y0) comp.y0 = y;
            if (y > comp.y1) comp.y1 = y;
            if (x > 0 && data[p - 1] >= 128 && labels[p - 1] === 0) { labels[p - 1] = label; stack[sp++] = p - 1; }
            if (x < width - 1 && data[p + 1] >= 128 && labels[p + 1] === 0) { labels[p + 1] = label; stack[sp++] = p + 1; }
            if (y > 0 && data[p - width] >= 128 && labels[p - width] === 0) { labels[p - width] = label; stack[sp++] = p - width; }
            if (y < height - 1 && data[p + width] >= 128 && labels[p + width] === 0) { labels[p + width] = label; stack[sp++] = p + width; }
        }
        components.push(comp);
    }
    return { labels, components };
}

/** Rotate by multiples of 90 degrees (clockwise) and/or mirror. Returns a new bitmap. */
export function transformBitmap(b: Bitmap, rotation: 0 | 90 | 180 | 270, mirrorX: boolean, mirrorY: boolean): Bitmap {
    let cur = b;
    if (mirrorX || mirrorY) {
        const out = createBitmap(cur.width, cur.height);
        for (let y = 0; y < cur.height; y++) {
            const sy = mirrorY ? cur.height - 1 - y : y;
            for (let x = 0; x < cur.width; x++) {
                const sx = mirrorX ? cur.width - 1 - x : x;
                out.data[y * cur.width + x] = cur.data[sy * cur.width + sx];
            }
        }
        cur = out;
    }
    if (rotation === 0) return cur === b ? cloneBitmap(b) : cur;
    const w = cur.width, h = cur.height;
    const outW = rotation === 180 ? w : h;
    const outH = rotation === 180 ? h : w;
    const out = createBitmap(outW, outH);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = cur.data[y * w + x];
            let nx: number, ny: number;
            if (rotation === 90) { nx = h - 1 - y; ny = x; }
            else if (rotation === 180) { nx = w - 1 - x; ny = h - 1 - y; }
            else { nx = y; ny = w - 1 - x; }
            out.data[ny * outW + nx] = v;
        }
    }
    return out;
}

/** Bounding box of ON pixels, or null if empty. */
export function boundingBox(b: Bitmap): { x0: number, y0: number, x1: number, y1: number } | null {
    let x0 = b.width, y0 = b.height, x1 = -1, y1 = -1;
    for (let y = 0; y < b.height; y++) {
        const row = y * b.width;
        for (let x = 0; x < b.width; x++) {
            if (b.data[row + x] >= 128) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
}
