/**
 * Rasterise an image (PNG / JPEG / SVG) to a printer-resolution bitmap and place it on the screen.
 */
import { createBitmap, transformBitmap } from "./bitmap";
import type { Bitmap } from "./bitmap";

export interface RasterOptions {
    /** Physical width of the image on the substrate, in mm. Height follows the aspect ratio. */
    widthMm: number;
    /** Printer pixel size, mm. */
    pixelMm: number;
    /** Which colour is "exposed": true = white/bright pixels are exposed. */
    brightIsExposed: boolean;
    /** Luminance threshold 0..255. */
    threshold: number;
}

export function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo cargar la imagen")); };
        img.src = url;
    });
}

/** Try to read the physical width (mm) from an SVG file's width attribute. */
export async function svgWidthMm(file: File): Promise<number | null> {
    if (!file.name.toLowerCase().endsWith(".svg")) return null;
    const text = await file.text();
    const m = text.match(/<svg[^>]*\swidth="([\d.]+)(mm|cm|in|px)?"/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    switch (m[2]) {
        case "mm": return v;
        case "cm": return v * 10;
        case "in": return v * 25.4;
        default: return null;
    }
}

/** Rasterise to a bitmap whose size is the image's physical size in printer pixels. */
export function rasterizeImage(img: HTMLImageElement, opts: RasterOptions): Bitmap {
    const wPx = Math.max(1, Math.round(opts.widthMm / opts.pixelMm));
    const aspect = (img.naturalHeight || img.height) / (img.naturalWidth || img.width);
    const hPx = Math.max(1, Math.round(wPx * aspect));
    const canvas = document.createElement("canvas");
    canvas.width = wPx;
    canvas.height = hPx;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = opts.brightIsExposed ? "black" : "white";
    ctx.fillRect(0, 0, wPx, hPx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, wPx, hPx);
    const data = ctx.getImageData(0, 0, wPx, hPx).data;
    const out = createBitmap(wPx, hPx);
    for (let i = 0; i < wPx * hPx; i++) {
        const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        const bright = lum >= opts.threshold;
        out.data[i] = (bright === opts.brightIsExposed) ? 255 : 0;
    }
    return out;
}

export interface PlacementOptions {
    /** Offset of the image centre from the screen centre, in pixels (x right, y down). */
    offsetX: number;
    offsetY: number;
    rotation: 0 | 90 | 180 | 270;
    mirrorX: boolean;
    mirrorY: boolean;
}

/** Place a bitmap on a screen of the given size, centred plus offset, after rotation/mirror. */
export function placeOnScreen(src: Bitmap, screenW: number, screenH: number, p: PlacementOptions): { screen: Bitmap, field: { x0: number, y0: number, x1: number, y1: number } } {
    const t = transformBitmap(src, p.rotation, p.mirrorX, p.mirrorY);
    const screen = createBitmap(screenW, screenH);
    const x0 = Math.round(screenW / 2 - t.width / 2 + p.offsetX);
    const y0 = Math.round(screenH / 2 - t.height / 2 + p.offsetY);
    for (let y = 0; y < t.height; y++) {
        const sy = y0 + y;
        if (sy < 0 || sy >= screenH) continue;
        const xs = Math.max(0, -x0), xe = Math.min(t.width, screenW - x0);
        if (xe <= xs) continue;
        screen.data.set(t.data.subarray(y * t.width + xs, y * t.width + xe), sy * screenW + x0 + xs);
    }
    return { screen, field: { x0, y0, x1: x0 + t.width - 1, y1: y0 + t.height - 1 } };
}
