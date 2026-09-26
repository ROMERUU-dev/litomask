import { createBitmap, fillRect, dilate, erode, labelComponents, transformBitmap, countOn } from "../bitmap";
import { encodeRLE4, encodeRLE } from "../../formats/anycubic";
import { applyRuleOpc, applyModelOpc } from "../opc";
import { splitMask, alignmentMarks } from "../split";
import { fitCalibration, predictWidth, erfinv, erf, simulateExposure } from "../simulate";
import { generateTestPattern, defaultTestPatternOptions, renderText } from "../testpattern";

/** Reference decoder for the PW0 RLE4 format (port of UVtools DecodePW0). */
function decodeRLE4(enc: Uint8Array, n: number): Uint8Array {
    const out = new Uint8Array(n);
    let pos = 0;
    for (let i = 0; i < enc.length; i++) {
        const b = enc[i];
        const code = b >> 4;
        let repeat = b & 0xf;
        let color: number;
        if (code === 0 || code === 0xf) {
            color = code === 0 ? 0 : 255;
            i++;
            repeat = (repeat << 8) + enc[i];
        } else {
            color = (code << 4) | code;
        }
        out.fill(color, pos, pos + repeat);
        pos += repeat;
    }
    expect(pos).toBe(n);
    return out;
}

function decodeRLE(enc: Uint8Array, n: number): Uint8Array {
    const out = new Uint8Array(n);
    let pos = 0;
    for (let i = 0; i < enc.length; i++) {
        const b = enc[i];
        const reps = b & 0x7f;
        if (b & 0x80) out.fill(255, pos, pos + reps);
        pos += reps;
    }
    expect(pos).toBe(n);
    return out;
}

describe("layer encoders", () => {
    test("RLE4 round-trips binary and grey data including long runs", () => {
        const n = 10000;
        const px = new Uint8Array(n);
        px.fill(255, 100, 5000);          // long white run (> 4095)
        px.fill(0x77, 5000, 5030);        // grey run > 15
        px.fill(0x33, 6000, 6003);
        const dec = decodeRLE4(encodeRLE4(px), n);
        for (let i = 0; i < n; i++) {
            const expected = (px[i] >> 4) * 17;
            expect(dec[i]).toBe(expected);
        }
    });

    test("RLE (1-bit) round-trips", () => {
        const n = 1000;
        const px = new Uint8Array(n);
        px.fill(255, 0, 300);
        px.fill(255, 400, 401);
        const dec = decodeRLE(encodeRLE(px), n);
        for (let i = 0; i < n; i++) expect(dec[i]).toBe(px[i] >= 128 ? 255 : 0);
    });
});

describe("bitmap morphology", () => {
    test("dilate then erode restores a square", () => {
        const b = createBitmap(50, 50);
        fillRect(b, 10, 10, 20, 20);
        const d = dilate(b, 2);
        expect(countOn(d)).toBe(24 * 24);
        const e = erode(d, 2);
        expect(countOn(e)).toBe(400);
        for (let i = 0; i < b.data.length; i++) expect(e.data[i]).toBe(b.data[i]);
    });

    test("component labelling and rotation", () => {
        const b = createBitmap(40, 20);
        fillRect(b, 2, 2, 5, 5);
        fillRect(b, 20, 2, 5, 10);
        const { components } = labelComponents(b);
        expect(components.length).toBe(2);
        const r = transformBitmap(b, 90, false, false);
        expect(r.width).toBe(20);
        expect(r.height).toBe(40);
        expect(countOn(r)).toBe(countOn(b));
    });
});

describe("rule-based OPC", () => {
    test("adds serifs on the four convex corners of a square", () => {
        const b = createBitmap(60, 60);
        fillRect(b, 20, 20, 20, 20);
        const out = applyRuleOpc(b, { convexSerif: 2, concaveSerif: 0, bias: 0 });
        // each serif of side 2 centred on a vertex adds 3 pixels outside the square
        expect(countOn(out)).toBe(400 + 4 * 3);
        expect(out.data[19 * 60 + 19]).toBe(255); // diagonal outside pixel at the TL vertex
        expect(out.data[18 * 60 + 18]).toBe(0);
    });

    test("removes anti-serifs on concave corners of an L", () => {
        const b = createBitmap(60, 60);
        fillRect(b, 10, 10, 30, 10);
        fillRect(b, 10, 10, 10, 30);
        const out = applyRuleOpc(b, { convexSerif: 0, concaveSerif: 2, bias: 0 });
        // exactly one concave corner at vertex (20,20); its 2x2 square removes 3 ON pixels
        expect(countOn(out)).toBe(countOn(b) - 3);
        expect(out.data[19 * 60 + 19]).toBe(0);
    });

    test("bias widens features", () => {
        const b = createBitmap(60, 60);
        fillRect(b, 20, 20, 10, 10);
        const out = applyRuleOpc(b, { convexSerif: 0, concaveSerif: 0, bias: 1 });
        expect(countOn(out)).toBe(144);
    });
});

describe("model-based OPC", () => {
    test("reduces the residual between simulation and design", () => {
        const b = createBitmap(80, 80);
        fillRect(b, 20, 20, 40, 40);
        fillRect(b, 20, 20, 4, 40);
        const sigma = 1.5, thr = 0.5;
        const before = simulateExposure(b, sigma, thr);
        let r0 = 0;
        for (let i = 0; i < b.data.length; i++) if (before.data[i] !== b.data[i]) r0++;
        const res = applyModelOpc(b, { sigmaPx: sigma, threshold: thr, iterations: 6, band: 4 });
        expect(res.residual).toBeLessThanOrEqual(r0);
        expect(res.history.length).toBeGreaterThan(0);
    });
});

describe("double patterning split", () => {
    test("alternating lines go to alternating masks", () => {
        const b = createBitmap(100, 40);
        for (let i = 0; i < 6; i++) fillRect(b, 10 + i * 6, 5, 3, 30); // 3 px lines, 3 px gaps
        const r = splitMask(b, 4);
        expect(r.countA).toBe(3);
        expect(r.countB).toBe(3);
        expect(r.conflicts).toBe(0);
        expect(countOn(r.a) + countOn(r.b)).toBe(countOn(b));
        // line 0 in A, line 1 in B
        expect(r.a.data[10 * 100 + 10]).toBe(255);
        expect(r.b.data[10 * 100 + 16]).toBe(255);
    });

    test("far-apart features stay in A", () => {
        const b = createBitmap(100, 40);
        fillRect(b, 5, 5, 10, 10);
        fillRect(b, 60, 5, 10, 10);
        const r = splitMask(b, 4);
        expect(r.countA).toBe(2);
        expect(r.countB).toBe(0);
    });

    test("alignment marks are drawn in both", () => {
        const m = alignmentMarks(200, 200, { x0: 50, y0: 50, x1: 150, y1: 150 }, { size: 20, lineWidth: 2, inset: 20, corners: { tl: true, tr: true, bl: true, br: true } });
        expect(countOn(m.a)).toBeGreaterThan(0);
        expect(countOn(m.b)).toBeGreaterThan(0);
        expect(countOn(m.both)).toBeGreaterThanOrEqual(countOn(m.a));
    });
});

describe("calibration fit", () => {
    test("erf/erfinv are consistent", () => {
        for (const x of [-0.9, -0.3, 0, 0.2, 0.7, 0.95]) expect(erf(erfinv(x))).toBeCloseTo(x, 5);
    });

    test("recovers sigma and D0 from synthetic widths", () => {
        const sigma = 50, d0 = 12, w0 = 3500;
        const doses = [15, 20, 30, 40, 60, 80, 120];
        const pts = doses.map(dose => ({ dose, width: predictWidth(w0, sigma, d0, dose) }));
        const fit = fitCalibration(pts, w0)!;
        expect(fit).not.toBeNull();
        expect(fit.sigma).toBeCloseTo(sigma, 0);
        expect(fit.d0).toBeCloseTo(d0, 0);
        expect(fit.rms).toBeLessThan(1);
    });
});

describe("test pattern", () => {
    test("dose layers contain decreasing numbers of cells", () => {
        const opts = { ...defaultTestPatternOptions, cells: 4, cellPitch: 200 };
        const r = generateTestPattern(1000, 500, opts);
        expect(r.doseLayers.length).toBe(4);
        const counts = r.doseLayers.map(countOn);
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThan(counts[i - 1]);
        expect(countOn(r.doseLayers[0])).toBe(countOn(r.all));
        expect(countOn(r.doseLayers[3])).toBe(countOn(r.cells[3]));
    });

    test("text renders", () => {
        const t = renderText("12F", 2);
        expect(t.width).toBe(22);
        expect(countOn(t)).toBeGreaterThan(0);
    });
});
