/**
 * Writer for Anycubic "Photon Workshop" binary files (pws/pw0/pwmx/pwma/pm3/pm3n/...).
 *
 * Layout reverse-engineered from UVtools (UVtools.Core/FileFormats/AnycubicFile.cs).
 * Supported container versions:
 *   1   : Photon S / Mono / Mono SE / Mono X / Photon X / Zero
 *   515 : Photon Ultra / Mono SQ
 *   516 : M3 / M3 Max / Mono 4K / Mono X 6K
 *   517 : Photon Mono 2 (.pm3n)
 *
 * All multi-byte integers are little-endian.
 */

export interface PhotonPrinterSettings {
    fileVersion: [number, number];
    xyRes: number;                          // mm per pixel
    resolution: [number, number];           // [x, y] pixels, as the printer expects
    physicalDimensions?: [number, number, number]; // display width, height, machine Z (mm)
    previewResolution: [number, number];
    encoding: "RLE" | "RLE4";
    printerModel?: string;                  // machine name written to MACHINE section (v516+)
}

export interface PhotonLayerInput {
    /** Greyscale pixels, one byte per pixel, row-major, length = resolution[0]*resolution[1]. 255 = exposed. */
    pixels: Uint8Array;
    /** Exposure time (s). Defaults to `exposureTime` of the build options. */
    exposureTime?: number;
}

export interface PhotonBuildOptions {
    /** Exposure time per layer, seconds. */
    exposureTime: number;
    /** Light-off delay before curing each layer, seconds (used as pause between pulses). */
    waitTimeBeforeCure?: number;
    /** Nominal layer height (mm). Irrelevant for lithography; kept small. */
    layerHeight?: number;
    /** Lift height between layers (mm). 0 for lithography. */
    liftHeight?: number;
    liftSpeed?: number;
    retractSpeed?: number;
}

const RLE_MAX_RUN = 0x7d;     // 125, matches UVtools RLE1EncodingLimit
const RLE4_MAX_RUN = 0xfff;   // 4095

// ----------------------------------------------------------------------------
// Growable little-endian binary writer
// ----------------------------------------------------------------------------
class BinWriter {
    private buf: ArrayBuffer;
    private view: DataView;
    private bytes: Uint8Array;
    public pos = 0;
    public length = 0;

    constructor(initialSize = 1 << 20) {
        this.buf = new ArrayBuffer(initialSize);
        this.view = new DataView(this.buf);
        this.bytes = new Uint8Array(this.buf);
    }

    private ensure(n: number) {
        const needed = this.pos + n;
        if (needed <= this.buf.byteLength) return;
        let size = this.buf.byteLength * 2;
        while (size < needed) size *= 2;
        const nb = new ArrayBuffer(size);
        new Uint8Array(nb).set(this.bytes.subarray(0, this.length));
        this.buf = nb;
        this.view = new DataView(nb);
        this.bytes = new Uint8Array(nb);
    }

    private advance(n: number) {
        this.pos += n;
        if (this.pos > this.length) this.length = this.pos;
    }

    seek(p: number) { this.ensure(p - this.pos > 0 ? p - this.pos : 0); this.pos = p; if (p > this.length) this.length = p; }
    u8(v: number) { this.ensure(1); this.view.setUint8(this.pos, v); this.advance(1); }
    u16(v: number) { this.ensure(2); this.view.setUint16(this.pos, v, true); this.advance(2); }
    u32(v: number) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.advance(4); }
    f32(v: number) { this.ensure(4); this.view.setFloat32(this.pos, v, true); this.advance(4); }
    /** Fixed-length zero-padded ASCII string */
    str(s: string, len: number) {
        this.ensure(len);
        // ASCII only (section marks, machine name, software strings)
        for (let i = 0; i < len; i++) this.view.setUint8(this.pos + i, i < s.length ? (s.charCodeAt(i) & 0x7f) : 0);
        this.advance(len);
    }
    raw(data: Uint8Array) { this.ensure(data.length); this.bytes.set(data, this.pos); this.advance(data.length); }
    zeros(n: number) { this.ensure(n); this.bytes.fill(0, this.pos, this.pos + n); this.advance(n); }

    /** Patch a u32 at an absolute offset without moving the cursor */
    patchU32(offset: number, v: number) { this.view.setUint32(offset, v >>> 0, true); }

    toBytes(): Uint8Array<ArrayBuffer> { return new Uint8Array(this.buf.slice(0, this.length)); }
}

// ----------------------------------------------------------------------------
// Layer image encoders
// ----------------------------------------------------------------------------

/** PW0 "RLE4": 4-bit grey per run. 0x0 / 0xF runs are 12-bit (2 bytes), grey runs are 4-bit (1 byte). */
export function encodeRLE4(pixels: Uint8Array): Uint8Array {
    const out: number[] = [];
    let last = -1;
    let reps = 0;

    const flush = () => {
        while (reps > 0) {
            let done = reps;
            if (last === 0 || last === 0xf) {
                if (done > RLE4_MAX_RUN) done = RLE4_MAX_RUN;
                const more = done | (last << 12);
                out.push((more >> 8) & 0xff, more & 0xff);
            } else {
                if (done > 0xf) done = 0xf;
                out.push((done | (last << 4)) & 0xff);
            }
            reps -= done;
        }
    };

    for (let i = 0; i < pixels.length; i++) {
        const c = pixels[i] >> 4;
        if (c === last) {
            reps++;
        } else {
            flush();
            last = c;
            reps = 1;
        }
    }
    flush();
    return Uint8Array.from(out);
}

/** PWS 1-bit RLE (Photon / Photon S): high bit = colour, low 7 bits = run length. Single AA level. */
export function encodeRLE(pixels: Uint8Array): Uint8Array {
    const out: number[] = [];
    let obit = false;
    let rep = 0;
    const add = () => { if (rep > 0) out.push((rep | (obit ? 0x80 : 0)) & 0xff); };
    for (let i = 0; i < pixels.length; i++) {
        const nbit = pixels[i] >= 128;
        if (nbit === obit) {
            rep++;
            if (rep === RLE_MAX_RUN) { add(); rep = 0; }
        } else {
            add();
            obit = nbit;
            rep = 1;
        }
    }
    add();
    return Uint8Array.from(out);
}

function countNonZero(pixels: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) n++;
    return n;
}

// ----------------------------------------------------------------------------
// Main builder
// ----------------------------------------------------------------------------

/**
 * Build a Photon Workshop file with one or more layers.
 *
 * @param layers       Layer bitmaps (greyscale, printer resolution).
 * @param previewRGBA  Preview thumbnail RGBA bytes (previewResolution).
 * @param options      Exposure / motion parameters.
 * @param printer      Printer definition.
 */
export function buildPhotonFileMulti(
    layers: PhotonLayerInput[],
    previewRGBA: Uint8Array | Uint8ClampedArray,
    options: PhotonBuildOptions,
    printer: PhotonPrinterSettings,
): Blob {
    if (layers.length === 0) throw new Error("At least one layer is required");
    const version = printer.fileVersion[0];
    const [resX, resY] = printer.resolution;
    const pixelCount = resX * resY;
    for (const l of layers) {
        if (l.pixels.length !== pixelCount) {
            throw new Error(`Layer pixel count ${l.pixels.length} does not match printer resolution ${resX}x${resY}`);
        }
    }

    const exposure = options.exposureTime;
    const wait = options.waitTimeBeforeCure ?? 0;
    const layerHeight = options.layerHeight ?? 0.05;
    const liftHeight = options.liftHeight ?? 0;
    const liftSpeed = options.liftSpeed ?? 4.0;
    const retractSpeed = options.retractSpeed ?? 4.0;

    const w = new BinWriter(4 << 20);

    // -------------------- FILE MARK (addresses patched at the end) --------------------
    // Field order: Mark(12) Version NumberOfTables HeaderAddr SoftwareAddr PreviewAddr
    //   LayerImageColorTableAddr LayerDefAddr ExtraAddr [MachineAddr >=516] LayerImageAddr [ModelAddr >=517]
    const numberOfTables = version === 1 ? 4 : version === 515 ? 5 : version === 516 ? 8 : 9;
    w.str("ANYCUBIC", 12);
    w.u32(version);
    w.u32(numberOfTables);
    const OFF_HEADER_ADDR = w.pos; w.u32(0);
    const OFF_SOFTWARE_ADDR = w.pos; w.u32(0);
    const OFF_PREVIEW_ADDR = w.pos; w.u32(0);
    const OFF_COLORTABLE_ADDR = w.pos; w.u32(0);
    const OFF_LAYERDEF_ADDR = w.pos; w.u32(0);
    const OFF_EXTRA_ADDR = w.pos; w.u32(0);
    let OFF_MACHINE_ADDR = -1;
    if (version >= 516) { OFF_MACHINE_ADDR = w.pos; w.u32(0); }
    const OFF_LAYERIMAGE_ADDR = w.pos; w.u32(0);
    let OFF_MODEL_ADDR = -1;
    if (version >= 517) { OFF_MODEL_ADDR = w.pos; w.u32(0); }

    // -------------------- HEADER --------------------
    const headerAddr = w.pos;
    w.patchU32(OFF_HEADER_ADDR, headerAddr);
    const headerLen = version >= 517 ? 92 : version >= 516 ? 84 : 80;
    w.str("HEADER", 12);
    w.u32(headerLen);
    w.f32(printer.xyRes * 1000);       // PixelSizeUm
    w.f32(layerHeight);                // LayerHeight
    w.f32(exposure);                   // ExposureTime (normal layers)
    w.f32(wait);                       // WaitTimeBeforeCure (light-off delay)
    w.f32(exposure);                   // BottomExposureTime
    w.f32(0);                          // BottomLayersCount (float!) — no bottom layers, all normal
    w.f32(liftHeight);                 // LiftHeight
    w.f32(liftSpeed);                  // LiftSpeed mm/s
    w.f32(retractSpeed);               // RetractSpeed mm/s
    w.f32(0);                          // VolumeMl
    w.u32(1);                          // AntiAliasing
    w.u32(resX);
    w.u32(resY);
    w.f32(0);                          // WeightG
    w.f32(0);                          // Price
    w.str("$", 4);                     // PriceCurrencySymbol
    w.u32(0);                          // PerLayerSettings (bool)
    w.u32(Math.round(layers.length * (exposure + wait)));  // PrintTime (s)
    w.u32(0);                          // TransitionLayerCount
    w.u32(0);                          // TransitionLayerType
    if (version >= 516) w.u32(0);      // AdvancedMode (0 = basic, no TSMC)
    if (version >= 517) {
        w.u16(0);                      // Grey
        w.u16(0);                      // BlurLevel
        w.u32(0);                      // ResinType
    }

    // -------------------- PREVIEW --------------------
    const [pvX, pvY] = printer.previewResolution;
    const previewAddr = w.pos;
    w.patchU32(OFF_PREVIEW_ADDR, previewAddr);
    const previewDataSize = pvX * pvY * 2;
    w.str("PREVIEW", 12);
    w.u32(16 + 12 + previewDataSize);  // includes base table length
    w.u32(pvX);
    w.str("x", 4);
    w.u32(pvY);
    if (previewRGBA.length !== pvX * pvY * 4) {
        throw new Error(`Preview must be ${pvX}x${pvY} RGBA`);
    }
    for (let i = 0; i < pvX * pvY; i++) {
        const r = previewRGBA[i * 4] >> 3;
        const g = previewRGBA[i * 4 + 1] >> 2;
        const b = previewRGBA[i * 4 + 2] >> 3;
        w.u16((r << 11) | (g << 5) | b);
    }

    // -------------------- LAYER IMAGE COLOR TABLE (>=515) --------------------
    if (version >= 515) {
        w.patchU32(OFF_COLORTABLE_ADDR, w.pos);
        w.u32(0);            // UseFullGreyscale
        w.u32(16);           // GreyMaxCount
        for (let i = 0; i < 16; i++) w.u8(255);   // AA = 1 -> every level maps to 255
        w.u32(0);            // Unknown
    }

    // -------------------- LAYERDEF (written now, patched later) --------------------
    const layerDefAddr = w.pos;
    w.patchU32(OFF_LAYERDEF_ADDR, layerDefAddr);
    w.str("LAYERDEF", 12);
    w.u32(4 + 32 * layers.length);
    w.u32(layers.length);
    const layerDefEntriesAddr = w.pos;
    w.zeros(32 * layers.length);

    // -------------------- EXTRA / MACHINE / SOFTWARE / MODEL (>=516) --------------------
    if (version >= 516) {
        w.patchU32(OFF_EXTRA_ADDR, w.pos);
        w.str("EXTRA", 12);
        w.u32(24);
        w.u32(2);                                   // BottomLiftCount
        w.f32(0); w.f32(liftSpeed); w.f32(retractSpeed);   // bottom lift 1
        w.f32(0); w.f32(liftSpeed); w.f32(retractSpeed);   // bottom lift 2
        w.u32(2);                                   // NormalLiftCount
        w.f32(0); w.f32(liftSpeed); w.f32(retractSpeed);   // lift 1
        w.f32(0); w.f32(liftSpeed); w.f32(retractSpeed);   // lift 2

        w.patchU32(OFF_MACHINE_ADDR, w.pos);
        const dims = printer.physicalDimensions ?? [resX * printer.xyRes, resY * printer.xyRes, 165];
        w.str("MACHINE", 12);
        w.u32(156);
        w.str(printer.printerModel ?? "", 96);
        w.str(printer.encoding === "RLE" ? "pwsImg" : "pw0Img", 16);
        w.u32(16);                                  // MaxAntialiasingLevel
        w.u32(version >= 517 ? 7 : 1);              // PropertyFields
        w.f32(dims[0]);
        w.f32(dims[1]);
        w.f32(dims[2]);
        w.u32(version);                             // MaxFileVersion
        w.u32(6506241);                             // MachineBackground

        if (version >= 517) {
            w.patchU32(OFF_SOFTWARE_ADDR, w.pos);
            w.str("photonic-etcher", 32);           // SoftwareName
            w.u32(164);                             // TableLength
            w.str("litho", 32);                     // Version
            w.str("browser", 64);                   // OperativeSystem
            w.str("3.3-CoreProfile", 32);           // OpenGLVersion

            w.patchU32(OFF_MODEL_ADDR, w.pos);
            w.str("MODEL", 12);
            w.u32(48);
            w.f32(-dims[0] / 2); w.f32(-dims[1] / 2); w.f32(0);          // Min XYZ
            w.f32(dims[0] / 2);  w.f32(dims[1] / 2);  w.f32(layerHeight * layers.length); // Max XYZ
            w.u32(0);                               // SupportsEnabled
            w.f32(0);                               // SupportsDensity
        }
    } else if (version === 515) {
        // UVtools sets ExtraAddress = LayerImageAddress for 515
        w.patchU32(OFF_EXTRA_ADDR, w.pos);
    }

    // -------------------- LAYER IMAGES --------------------
    w.patchU32(OFF_LAYERIMAGE_ADDR, w.pos);
    const defs: { addr: number, len: number, nonZero: number, exposure: number }[] = [];
    for (const layer of layers) {
        const enc = printer.encoding === "RLE4" ? encodeRLE4(layer.pixels) : encodeRLE(layer.pixels);
        const addr = w.pos;
        w.raw(enc);
        defs.push({ addr, len: enc.length, nonZero: countNonZero(layer.pixels), exposure: layer.exposureTime ?? exposure });
    }

    // -------------------- Patch LAYERDEF entries --------------------
    const end = w.pos;
    w.seek(layerDefEntriesAddr);
    for (const d of defs) {
        w.u32(d.addr);
        w.u32(d.len);
        w.f32(liftHeight);
        w.f32(liftSpeed);
        w.f32(d.exposure);
        w.f32(layerHeight);
        w.u32(d.nonZero);
        w.u32(0);
    }
    w.seek(end);

    return new Blob([w.toBytes()]);
}

/**
 * Backwards-compatible single-layer entry point used by the Gerber (PCB) pipeline.
 * `layerData` is RGBA from canvas ImageData; red channel is used as greyscale.
 * Non-255 pixels are treated as black (no anti-aliasing), preserving the original behaviour.
 */
export async function buildPhotonFile(layerData: Uint8ClampedArray | Uint8Array, previewData: Uint8ClampedArray | Uint8Array, exposureTime: number, printerSettings: PhotonPrinterSettings): Promise<Blob> {
    const n = layerData.length / 4;
    const grey = new Uint8Array(n);
    for (let i = 0; i < n; i++) grey[i] = layerData[i * 4] === 255 ? 255 : 0;
    return buildPhotonFileMulti([{ pixels: grey }], previewData, { exposureTime }, printerSettings);
}
