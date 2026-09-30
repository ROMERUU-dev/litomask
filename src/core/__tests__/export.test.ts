import { createBitmap, fillRect } from "../bitmap";
import { buildLithoFile, pulses, makeThumbnail } from "../export";
import { printerModels } from "../../formats/printers";
import { buildSceneSlice, buildLayerVolumes } from "../../formats/anycubicZip";
import JSZip from "jszip";

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
        const f = await buildLithoFile({ name: "t", layers: pulses(b, 3), exposureTime: 7.5, pause: 2 }, name, printer);
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

describe("Anycubic ZIP format (.pm4u)", () => {
    test("builds a .pm4u with every manifest and RLE layers", async () => {
        const name = "AnyCubic Photon Mono 4 Ultra (.pm4u)";
        const printer = printerModels[name];
        const [W, H] = printer.resolution;
        const b = createBitmap(W, H);
        fillRect(b, 1000, 1000, 200, 100);
        const fakePng = async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const f = await buildLithoFile({ name: "t", layers: pulses(b, 5), exposureTime: 4, pause: 1 }, name, printer, fakePng);
        expect(f.fileName).toBe("t.pm4u");
        const zip = await JSZip.loadAsync(await f.blob.arrayBuffer());
        const names = Object.keys(zip.files).sort();
        for (const req of ["anycubic_photon_resins.pwsp", "layers_controller.conf", "lcd_function.json", "print_info.json",
            "software_info.conf", "scene.slice", "calc_layer_volumes.data", "preview_images/preview_0.png", "preview_images/preview_2.png",
            "layer_images/layer_0.pw0Img", "layer_images/layer_4.pw0Img"]) {
            expect(names).toContain(req);
        }
        const settings = JSON.parse(await zip.file("anycubic_photon_resins.pwsp")!.async("string"));
        expect(settings.machine_type.name).toBe("Photon Mono 4 Ultra");
        expect(settings.machine_type.key_suffix).toBe("pm4u");
        expect(settings.machine_type.res_x).toBe(9024);
        expect(settings.machine_type.res_y).toBe(5120);
        expect(settings.machine_type.xy_pixel).toBeCloseTo(17);
        expect(settings.machine_extern.user_resins[0].slicepara.exposure_time).toBe(4);
        expect(settings.machine_extern.user_resins[0].slicepara.off_time).toBe(1);
        expect(settings.machine_extern.user_resins[0].slicepara.use_indivi_layerpara).toBe(0);
        const lc = JSON.parse(await zip.file("layers_controller.conf")!.async("string"));
        expect(lc.count).toBe(5);
        expect(lc.paras[4].layer_minheight).toBeCloseTo(0.2);
        expect(lc.paras[4].exposure_time).toBe(4);
        const pi = JSON.parse(await zip.file("print_info.json")!.async("string"));
        expect(pi.model_layers_count).toBe(5);
        // scene.slice: magic, size = 396 + 64 * n + 4
        const scene = await zip.file("scene.slice")!.async("uint8array");
        expect(String.fromCharCode(...Array.from(scene.subarray(0, 13)))).toBe("ANYCUBIC-PWSZ");
        expect(scene.length).toBe(396 + 64 * 5 + 4);
        const vol = await zip.file("calc_layer_volumes.data")!.async("uint8array");
        expect(new DataView(vol.buffer, vol.byteOffset).getUint32(0, true)).toBe(0x20251024);
        // RLE layer decodes back to the same pixel count
        const rle = await zip.file("layer_images/layer_0.pw0Img")!.async("uint8array");
        let pos = 0, on = 0;
        for (let i = 0; i < rle.length; i++) {
            const code = rle[i] >> 4; let rep = rle[i] & 0xf;
            if (code === 0 || code === 0xf) { i++; rep = (rep << 8) + rle[i]; }
            if (code === 0xf) on += rep;
            pos += rep;
        }
        expect(pos).toBe(W * H);
        expect(on).toBe(200 * 100);
    });

    test("volume table follows the 0.2 mm slab rule", () => {
        const v = buildLayerVolumes(Array(10).fill(1), 0.05);
        // 10 layers, 2 omitted on top, 8 effective, 4 per entry -> 2 entries
        expect(v.length).toBe(16 + 48 * 2);
        const s = buildSceneSlice([{ area: 1, x0: -1, y0: -1, x1: 1, y1: 1, count: 10 }], 0.05, "x");
        expect(s.length).toBe(396 + 64 + 4);
    });
});
