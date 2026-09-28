/**
 * Calibration test pattern and dose-matrix layer generation.
 *
 * Each cell contains:
 *  - a label (cell number),
 *  - a large square (edge / width measurement for the sigma fit),
 *  - isolated lines of increasing width,
 *  - line/space gratings of decreasing pitch,
 *  - a square with and without serifs, line ends with/without hammerhead,
 *  - an orientation glyph ("F") to detect mirroring / rotation.
 *
 * Dose matrix: cell k (1-based) is present in the first k layers, so with exposure t per
 * layer, cell k receives dose k·t.
 */
import { createBitmap, fillRect, blit } from "./bitmap";
import type { Bitmap } from "./bitmap";

// 3x5 pixel font for digits and a few letters
const FONT: { [ch: string]: string[] } = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "001", "001", "001"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    "F": ["111", "100", "111", "100", "100"],
    "A": ["010", "101", "111", "101", "101"],
    "B": ["110", "101", "110", "101", "110"],
    "-": ["000", "000", "111", "000", "000"],
    " ": ["000", "000", "000", "000", "000"],
};

/** Render text with the 3x5 font at integer scale `s` into a new bitmap. */
export function renderText(text: string, s: number): Bitmap {
    const chars = text.toUpperCase().split("");
    const w = chars.length * 4 * s - s, h = 5 * s;
    const b = createBitmap(Math.max(1, w), h);
    chars.forEach((ch, i) => {
        const glyph = FONT[ch] ?? FONT[" "];
        for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
            if (glyph[r][c] === "1") fillRect(b, i * 4 * s + c * s, r * s, s, s);
        }
    });
    return b;
}

export interface TestPatternOptions {
    /** Number of dose steps (cells). */
    cells: number;
    /** Cell pitch in pixels. */
    cellPitch: number;
    /** Side of the large measurement square (px). */
    squareSize: number;
    /** Isolated line widths (px). */
    lineWidths: number[];
    /** Grating pitches (px), line = space = pitch/2. */
    gratingPitches: number[];
    /** Serif size used in the serif demo square (px). */
    serifSize: number;
}

export const defaultTestPatternOptions: TestPatternOptions = {
    cells: 10,
    cellPitch: 380,
    squareSize: 100,
    lineWidths: [1, 2, 3, 4, 6, 8],
    gratingPitches: [2, 3, 4, 6, 8, 12, 16],
    serifSize: 2,
};

/** Draw one cell's content into a cellPitch x cellPitch bitmap. */
export function renderCell(index: number, opts: TestPatternOptions): Bitmap {
    const P = opts.cellPitch;
    const b = createBitmap(P, P);
    const m = 8; // margin
    let y = m;

    // Label + orientation glyph
    const label = renderText(String(index), 4);
    blit(b, label, m, y);
    const glyph = renderText("F", 8);
    blit(b, glyph, m + label.width + 3 * m, y);
    y += Math.max(label.height, glyph.height) + m;

    // Large square (left) and isolated lines (right)
    fillRect(b, m, y, opts.squareSize, opts.squareSize);
    let lx = m + opts.squareSize + 3 * m;
    const lineLen = opts.squareSize;
    for (const w of opts.lineWidths) {
        fillRect(b, lx, y, w, lineLen);
        lx += w + 14;
    }
    y += opts.squareSize + 2 * m;

    // Gratings: vertical lines, each block gratingBlock px wide
    const block = Math.floor((P - 2 * m) / opts.gratingPitches.length);
    const gHeight = 60;
    let gx = m;
    for (const pitch of opts.gratingPitches) {
        const line = Math.max(1, Math.round(pitch / 2));
        const usable = block - 6;
        for (let x = 0; x + line <= usable; x += pitch) fillRect(b, gx + x, y, line, gHeight);
        gx += block;
    }
    y += gHeight + 2 * m;

    // Horizontal gratings (to catch anisotropy)
    gx = m;
    for (const pitch of opts.gratingPitches) {
        const line = Math.max(1, Math.round(pitch / 2));
        const usable = block - 6;
        for (let yy = 0; yy + line <= 40; yy += pitch) fillRect(b, gx, y + yy, usable, line);
        gx += block;
    }
    y += 40 + 2 * m;

    // Serif demo: square without serifs, square with serifs, line end plain, line end with hammerhead
    const sq = 30, s = opts.serifSize;
    let dx = m;
    fillRect(b, dx, y, sq, sq); dx += sq + 3 * m;
    fillRect(b, dx, y, sq, sq);
    for (const [cx, cy] of [[dx, y], [dx + sq, y], [dx, y + sq], [dx + sq, y + sq]] as [number, number][]) {
        fillRect(b, cx - s / 2, cy - s / 2, s, s);
    }
    dx += sq + 3 * m;
    // plain line end (4 px wide, 40 long)
    fillRect(b, dx, y + sq / 2 - 2, 40, 4); dx += 40 + 2 * m;
    // hammerhead line end
    fillRect(b, dx, y + sq / 2 - 2, 40, 4);
    fillRect(b, dx + 40 - s, y + sq / 2 - 2 - s, s + 1, 4 + 2 * s);
    dx += 40 + 2 * m;
    // dense line pairs: gap 1..4 px between two 4-px lines
    for (const gap of [1, 2, 3, 4]) {
        fillRect(b, dx, y, 4, sq);
        fillRect(b, dx + 4 + gap, y, 4, sq);
        dx += 8 + gap + 8;
    }

    return b;
}

export interface TestPatternResult {
    /** Number of cells actually placed (may be fewer than requested on small screens). */
    cells_used: number;
    /** Full pattern with every cell (what you see at dose k·t for cell k when using the dose layers). */
    all: Bitmap;
    /** Per-cell bitmaps positioned on the screen (index 0 = cell 1). */
    cells: Bitmap[];
    /** Layer bitmaps for the dose matrix: layer j contains cells with k > j. */
    doseLayers: Bitmap[];
    /** Cell centre positions in pixels. */
    positions: { x: number, y: number }[];
}

/** Lay out the cells centred on a screen of width x height pixels. */
export function generateTestPattern(width: number, height: number, opts: TestPatternOptions): TestPatternResult {
    const P = opts.cellPitch;
    const cols = Math.max(1, Math.min(opts.cells, Math.floor(width / P)));
    const maxRows = Math.max(1, Math.floor(height / P));
    // Low-resolution screens cannot hold every cell: keep only the ones that fit
    const nCells = Math.min(opts.cells, cols * maxRows);
    opts = { ...opts, cells: nCells };
    const rows = Math.ceil(nCells / cols);
    const x0 = Math.floor((width - cols * P) / 2);
    const y0 = Math.floor((height - rows * P) / 2);

    const all = createBitmap(width, height);
    const cells: Bitmap[] = [];
    const positions: { x: number, y: number }[] = [];
    for (let k = 1; k <= opts.cells; k++) {
        const c = (k - 1) % cols, r = Math.floor((k - 1) / cols);
        const cellBmp = renderCell(k, opts);
        const px = x0 + c * P, py = y0 + r * P;
        const placed = createBitmap(width, height);
        blit(placed, cellBmp, px, py);
        cells.push(placed);
        blit(all, cellBmp, px, py);
        positions.push({ x: px + P / 2, y: py + P / 2 });
    }
    const doseLayers: Bitmap[] = [];
    for (let j = 0; j < opts.cells; j++) {
        const layer = createBitmap(width, height);
        for (let k = j + 1; k <= opts.cells; k++) {
            const src = cells[k - 1];
            for (let i = 0; i < src.data.length; i++) if (src.data[i]) layer.data[i] = 255;
        }
        doseLayers.push(layer);
    }
    return { cells_used: nCells, all, cells, doseLayers, positions };
}
