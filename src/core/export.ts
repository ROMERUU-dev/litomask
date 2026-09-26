/**
 * Assemble lithography jobs into printer files.
 */
import type { Bitmap } from "./bitmap";
import { buildPhotonFileMulti } from "../formats/anycubic";
import type { PhotonLayerInput } from "../formats/anycubic";
import { machineNameFor } from "../formats/printers";
import type { PrinterModel } from "../formats/printers";

export interface LithoJob {
    /** File name without extension. */
    name: string;
    /** Layer bitmaps in exposure order (screen resolution). */
    layers: Bitmap[];
    /** Exposure time per layer (s). */
    exposureTime: number;
    /** Pause before each layer (s). */
    pause: number;
}

export interface LithoFile {
    fileName: string;
    blob: Blob;
    layerCount: number;
    totalTimeS: number;
}

/** Build a thumbnail (RGBA) by box-downsampling the first layer. */
export function makeThumbnail(b: Bitmap, w: number, h: number): Uint8Array {
    const out = new Uint8Array(w * h * 4);
    const sx = b.width / w, sy = b.height / h;
    for (let y = 0; y < h; y++) {
        const by0 = Math.floor(y * sy), by1 = Math.max(by0 + 1, Math.floor((y + 1) * sy));
        for (let x = 0; x < w; x++) {
            const bx0 = Math.floor(x * sx), bx1 = Math.max(bx0 + 1, Math.floor((x + 1) * sx));
            let acc = 0, n = 0;
            for (let yy = by0; yy < by1; yy++) for (let xx = bx0; xx < bx1; xx++) { acc += b.data[yy * b.width + xx]; n++; }
            const v = acc / n / 255;
            const o = (y * w + x) * 4;
            // dark blue background, light cyan features
            out[o] = Math.round(20 + v * 180);
            out[o + 1] = Math.round(30 + v * 210);
            out[o + 2] = Math.round(60 + v * 180);
            out[o + 3] = 255;
        }
    }
    return out;
}

export function buildLithoFile(job: LithoJob, printerName: string, printer: PrinterModel): LithoFile {
    const [resX, resY] = printer.resolution;
    for (const l of job.layers) {
        if (l.width !== resX || l.height !== resY) {
            throw new Error(`La capa mide ${l.width}x${l.height} y la impresora espera ${resX}x${resY}`);
        }
    }
    const layers: PhotonLayerInput[] = job.layers.map(l => ({ pixels: l.data }));
    const thumb = makeThumbnail(job.layers[0], printer.previewResolution[0], printer.previewResolution[1]);
    const blob = buildPhotonFileMulti(layers, thumb, {
        exposureTime: job.exposureTime,
        waitTimeBeforeCure: job.pause,
        layerHeight: 0.05,
        liftHeight: 0,
    }, { ...printer, printerModel: machineNameFor(printerName) });
    return {
        fileName: `${job.name}.${printer.fileFormat}`,
        blob,
        layerCount: job.layers.length,
        totalTimeS: job.layers.length * (job.exposureTime + job.pause),
    };
}

/** Repeat one bitmap N times (N pulses). */
export function pulses(b: Bitmap, n: number): Bitmap[] {
    return Array.from({ length: Math.max(1, Math.round(n)) }, () => b);
}
