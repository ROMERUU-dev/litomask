import { createBitmap, fillRect } from "../bitmap";
import { buildLithoFile, pulses, makeThumbnail } from "../export";
import { printerModels } from "../../formats/printers";

function ascii(buf: ArrayBuffer, off: number, len: number): string {
    const a = new Uint8Array(buf, off, len);
    let s = "";
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return s;
}

describe("litho export", () => {
    test("builds a multi-layer .pm3n with the right header fields", async () => {
        const name = "AnyCubic Photon Mono 2 (.pm3n)";
        const printer = printerModels[name];
        const [W, H] = printer.resolution;
        const b = createBitmap(W, H);
        fillRect(b, 100, 100, 50, 50);
        const f = buildLithoFile({ name: "t", layers: pulses(b, 3), exposureTime: 7.5, pause: 2 }, name, printer);
        expect(f.fileName).toBe("t.pm3n");
        expect(f.layerCount).toBe(3);
        expect(f.totalTimeS).toBeCloseTo(28.5);
        const buf = new DataView(await f.blob.arrayBuffer());
        const magic = ascii(buf.buffer, 0, 8);
        expect(magic).toBe("ANYCUBIC");
        expect(buf.getUint32(12, true)).toBe(517);
        expect(buf.getUint32(16, true)).toBe(9);
        const headerAddr = buf.getUint32(20, true);
        expect(headerAddr).toBe(56);
        expect(buf.getUint32(headerAddr + 12, true)).toBe(92);       // header table length
        expect(buf.getFloat32(headerAddr + 16, true)).toBeCloseTo(35); // pixel size um
        expect(buf.getFloat32(headerAddr + 24, true)).toBeCloseTo(7.5); // exposure
        expect(buf.getFloat32(headerAddr + 28, true)).toBeCloseTo(2);   // wait before cure
        expect(buf.getUint32(headerAddr + 60, true)).toBe(W);
        expect(buf.getUint32(headerAddr + 64, true)).toBe(H);
        const layerDefAddr = buf.getUint32(36, true);
        expect(ascii(buf.buffer, layerDefAddr, 8)).toBe("LAYERDEF");
        expect(buf.getUint32(layerDefAddr + 16, true)).toBe(3);      // layer count
        expect(buf.getUint32(layerDefAddr + 20 + 24, true)).toBe(2500); // non-zero pixels of layer 0
        const machineAddr = buf.getUint32(44, true);
        const machine = ascii(buf.buffer, machineAddr + 16, 13);
        expect(machine).toBe("Photon Mono 2");
    });

    test("thumbnail has the requested size", () => {
        const b = createBitmap(400, 300);
        fillRect(b, 0, 0, 200, 300);
        const t = makeThumbnail(b, 224, 168);
        expect(t.length).toBe(224 * 168 * 4);
        expect(t[3]).toBe(255);
        expect(t[0]).toBeGreaterThan(t[(223) * 4]); // left brighter than right
    });
});
