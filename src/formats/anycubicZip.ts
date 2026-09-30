/**
 * Writer for the ZIP-based Anycubic format used by the newer Photon printers
 * (.pm4u Photon Mono 4 Ultra, .pm7 / .pm7m / .pwsz Photon Mono M7 family).
 *
 * Layout reverse-engineered from UVtools (UVtools.Core/FileFormats/AnycubicZipFile.cs) and
 * from files produced by UVtools 7.0. The archive holds:
 *   preview_images/preview_{0,1,2}.png      thumbnails 224x168, 336x252, 800x600
 *   anycubic_photon_resins.pwsp             machine + resin settings (JSON)
 *   layers_controller.conf                  per-layer exposure / height (JSON)
 *   lcd_function.json, print_info.json, software_info.conf (JSON)
 *   layer_images/layer_N.pw0Img             RLE4 layer bitmaps (same encoding as .pm3n)
 *   scene.slice                             binary per-layer bounding boxes / areas
 *   calc_layer_volumes.data                 binary volume table per 0.2 mm slab
 */
import JSZip from "jszip";
import { encodeRLE4 } from "./anycubic";
import type { PhotonLayerInput } from "./anycubic";

export interface ZipPrinterSettings {
    /** Machine name as Photon Workshop writes it, e.g. "Photon Mono 4 Ultra". */
    machineName: string;
    /** File extension / key suffix, e.g. "pm4u". */
    keySuffix: string;
    resolution: [number, number];
    /** Pixel size in mm. */
    xyRes: number;
    /** Display width, height and machine Z in mm. */
    physicalDimensions: [number, number, number];
}

export interface ZipBuildOptions {
    exposureTime: number;
    /** Light-off delay (s), written as off_time. */
    waitTimeBeforeCure?: number;
    layerHeight?: number;
    liftHeight?: number;
    liftSpeed?: number;
    /** PNG-encoded thumbnails in the order 224x168, 336x252, 800x600 (optional). */
    previewPngs?: Uint8Array[];
    softwareName?: string;
    softwareVersion?: string;
}

const PREVIEW_SIZES: [number, number][] = [[224, 168], [336, 252], [800, 600]];
export const ZIP_PREVIEW_SIZES = PREVIEW_SIZES;

function round4(v: number): number { return Math.round(v * 10000) / 10000; }

/** Per-layer geometry needed by scene.slice and the volume table. */
function layerStats(pixels: Uint8Array, w: number, h: number) {
    let count = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            if (pixels[row + x] >= 128) {
                count++;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
    return { count, x0, y0, x1, y1 };
}

class Bin {
    private buf: ArrayBuffer;
    private view: DataView;
    private bytes: Uint8Array;
    pos = 0;
    constructor(size: number) { this.buf = new ArrayBuffer(size); this.view = new DataView(this.buf); this.bytes = new Uint8Array(this.buf); }
    u32(v: number) { this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
    f32(v: number) { this.view.setFloat32(this.pos, v, true); this.pos += 4; }
    str(s: string, len: number) { for (let i = 0; i < len; i++) this.bytes[this.pos + i] = i < s.length ? s.charCodeAt(i) & 0x7f : 0; this.pos += len; }
    zeros(n: number) { this.pos += n; }
    done(): Uint8Array<ArrayBuffer> { return new Uint8Array(this.buf.slice(0, this.pos)); }
}

export interface ZipLayerInfo { area: number; x0: number; y0: number; x1: number; y1: number; count: number }

/** scene.slice: header + one 64-byte record per layer. Offsets are mm from the display centre. */
export function buildSceneSlice(layers: ZipLayerInfo[], layerHeight: number, software: string): Uint8Array {
    const n = layers.length;
    const b = new Bin(16 + 64 + 4 * 7 + 4 * 7 + 256 + 4 + 4 + 64 * n + 4);
    b.str("ANYCUBIC-PWSZ", 16);
    b.str(software, 64);
    b.u32(3);                       // BinaryType
    b.u32(1);                       // Version
    b.u32(0);                       // SliceType
    b.u32(0);                       // ModelUnit
    b.f32(1);                       // PointRatio
    b.u32(n);                       // LayerCount
    const xs = Math.min(...layers.map(l => l.x0)), ys = Math.min(...layers.map(l => l.y0));
    const xe = Math.max(...layers.map(l => l.x1)), ye = Math.max(...layers.map(l => l.y1));
    b.f32(round4(xs)); b.f32(round4(ys)); b.f32(0);
    b.f32(round4(xe)); b.f32(round4(ye)); b.f32(round4(layerHeight * n));
    b.u32(0);                       // ModelStats
    b.zeros(256);                   // Padding
    b.str("<---", 4);
    b.u32(n);
    for (let i = 0; i < n; i++) {
        const l = layers[i];
        b.f32(round4(layerHeight * (i + 1)));
        b.f32(round4(l.area));
        b.f32(round4(l.x0)); b.f32(round4(l.y0)); b.f32(round4(l.x1)); b.f32(round4(l.y1));
        b.u32(l.count > 0 ? 1 : 0);  // ObjectCount (one connected object assumed)
        b.f32(round4(l.area));       // MaxContourArea
        b.zeros(32);
    }
    b.str("--->", 4);
    return b.done();
}

/** calc_layer_volumes.data: volume per 0.2 mm slab, as UVtools 7 computes it. */
export function buildLayerVolumes(areasMm2: number[], layerHeight: number): Uint8Array {
    const n = areasMm2.length;
    const baseStep = 0.2;
    const layersPerEntry = Math.max(1, Math.round(baseStep / layerHeight));
    const omittedTop = Math.max(1, Math.round((baseStep / 2) / layerHeight));
    const effective = Math.max(1, n - omittedTop);
    const entries: { ref: number, z: number, thickness: number, raw: number }[] = [];
    let z = 0;
    for (let start = 0; start < effective;) {
        const take = Math.min(layersPerEntry, effective - start);
        let thickness = 0, raw = 0;
        for (let k = 0; k < take; k++) {
            thickness += layerHeight;
            raw += areasMm2[Math.min(n - 1, start + k)] * layerHeight;
        }
        entries.push({ ref: start === 0 ? 0 : start - 1, z: round4(z), thickness: round4(thickness), raw: round4(raw) });
        z += thickness;
        start += take;
    }
    const b = new Bin(16 + 48 * entries.length);
    b.u32(0x20251024);
    b.f32(baseStep);
    b.u32(1);
    b.u32(entries.length);
    for (const e of entries) { b.u32(e.ref); b.f32(e.z); b.f32(e.thickness); b.zeros(32); b.f32(e.raw); }
    return b.done();
}

function resinBlock(exposure: number, offTime: number, layerHeight: number, liftHeight: number, liftSpeed: number, bottomLayers: number) {
    return {
        version: "2",
        property: {
            version: "3", code: "10", currency: "€", price: 25, type: "Standard resin", volume: 1000, subfunc_code: 0,
            density: 1.2, target_temperature: 25, brand_name: "Unknown", resin_name: "Unknown", film_name: "NFEP",
            setting_name: "Unknown", name: "default_resin",
        },
        depth_penetration_curve: {
            zthick_min: 0.01, zthick_max: 0.2, light_intensity: 9000, safety_coefficient: 1.6, current_tempcurve_selector: 0,
            temperature_coefficients: [
                { temperature: 10, x_coefficient: 184.27, y_compensation: 1675.8 },
                { temperature: 25, x_coefficient: 197.78, y_compensation: 1803.2 },
                { temperature: 35, x_coefficient: 161.19, y_compensation: 1417.3 },
                { temperature: 45, x_coefficient: 167.31, y_compensation: 1480.9 },
                { temperature: 55, x_coefficient: 166.76, y_compensation: 1474.1 },
            ],
        },
        slice_extpara: {
            version: "3", multi_state_used: 0, transition_layercount: 0, transition_type: 0,
            multi_state_paras: {
                bott_0: { height: liftHeight, up_speed: liftSpeed, down_speed: liftSpeed },
                bott_1: { height: 0, up_speed: 5, down_speed: 1.33 },
                normal_0: { height: liftHeight, up_speed: liftSpeed, down_speed: liftSpeed },
                normal_1: { height: 0, up_speed: 5, down_speed: 1.33 },
            },
            exposure_compensate: 0, intelli_mode: 0, max_acceleration: 2, separate_support_exposure_delayed: 0,
            material_scale_coeffs: [], material_scale_coeffs_mode: 0, material_scale_xyz: { x: 1, y: 1, z: 1 },
        },
        slicepara: {
            anti_count: 1, blur_level: 0, bott_layers: bottomLayers, bott_off_time: offTime, bott_time: exposure,
            bott_wait_before_lift: 0, bott_time_dual: exposure, exposure_time: exposure, wait_before_lift: 0,
            gray_level: 0, off_time: offTime, use_indivi_layerpara: 0, use_random_erode: 0, zthick: layerHeight,
            zup_height: liftHeight, zup_speed: liftSpeed, zdown_speed: liftSpeed, bott_wait_after_lift: 0, wait_after_lift: 0,
        },
    };
}

export async function buildAnycubicZip(layers: PhotonLayerInput[], options: ZipBuildOptions, printer: ZipPrinterSettings): Promise<Blob> {
    if (layers.length === 0) throw new Error("At least one layer is required");
    const [w, h] = printer.resolution;
    const n = layers.length;
    const exposure = options.exposureTime;
    const offTime = options.waitTimeBeforeCure ?? 0;
    const layerHeight = options.layerHeight ?? 0.05;
    const liftHeight = options.liftHeight ?? 0;
    const liftSpeed = options.liftSpeed ?? 1.67;
    const software = options.softwareName ?? "LitoMask";
    const version = options.softwareVersion ?? "0.1.0";
    const pixelUm = printer.xyRes * 1000;
    const pixelArea = printer.xyRes * printer.xyRes; // mm²
    const [dispW, dispH, machineZ] = printer.physicalDimensions;

    const zip = new JSZip();
    // No directory entries: Photon Workshop / UVtools archives list files only.
    const add = (name: string, data: string | Uint8Array) => zip.file(name, data, { createFolders: false });

    // ---- previews ----
    (options.previewPngs ?? []).forEach((png, i) => {
        if (png && png.length) add(`preview_images/preview_${i}.png`, png);
    });

    // ---- layers: RLE + geometry ----
    const infos: ZipLayerInfo[] = [];
    for (let i = 0; i < n; i++) {
        const px = layers[i].pixels;
        if (px.length !== w * h) throw new Error(`Layer pixel count ${px.length} does not match printer resolution ${w}x${h}`);
        add(`layer_images/layer_${i}.pw0Img`, encodeRLE4(px));
        const s = layerStats(px, w, h);
        infos.push({
            count: s.count,
            area: s.count * pixelArea,
            x0: s.x0 * printer.xyRes - dispW / 2, y0: s.y0 * printer.xyRes - dispH / 2,
            x1: (s.x1 + 1) * printer.xyRes - dispW / 2, y1: (s.y1 + 1) * printer.xyRes - dispH / 2,
        });
    }
    const volumeMm3 = infos.reduce((a, l) => a + l.area * layerHeight, 0);
    const volumeMl = round4(volumeMm3 / 1000);
    const grams = round4(volumeMl * 1.2);
    const printTime = Math.round(n * (exposure + offTime + 1));

    // ---- JSON manifests ----
    const settings = {
        version: "3",
        machine_type: {
            version: "3",
            name: printer.machineName,
            key_suffix: printer.keySuffix,
            key_image_format: "pwszImg",
            res_x: w, res_y: h,
            xy_pixel: pixelUm, xy_pixel_y: pixelUm,
            rotate_z: 0, max_samples: 16, property: 119,
            print_xsize: dispW, print_ysize: dispH, print_zsize: machineZ,
            max_file_version: 518,
            prev_back_color: [0, 0.28, 0.39], prev_model_color: [0.8, 0.8, 0.8], prev_supports_color: [0.07, 0.93, 0.93],
            prev_image_size: [224, 168],
            child_screen: [{ x: 0, y: 0, width: w, height: h }],
            prev2_back_color: [0.08, 0.11, 0.16], prev2_image_size: [336, 252],
            raster_segments_capacity: 0, raster_antialiasing: 8,
            cloudprev_back_color: [0, 0.28, 0.39], cloudprev_imag_size: [800, 600],
            print_platform_zheights: [0],
        },
        machine_extern: {
            version: "3",
            alias: printer.machineName,
            picture: `${printer.machineName.replace(/ /g, "")}.png`,
            cloud_property: 0,
            device_cn_code: "",
            factory_resins: [resinBlock(exposure, offTime, layerHeight, liftHeight, liftSpeed, 0)],
            user_resins: [resinBlock(exposure, offTime, layerHeight, liftHeight, liftSpeed, 0)],
            active_resins: ["default_resin"],
            firmware_calc_print_time: 1,
            firmware_calc_print_time_paras: {
                version: "2",
                MACHINE_AXIS_STEPS_PER_UNIT: [100, 100, 3200, 94], MACHINE_BLOCK_BUFFER_SIZE: 32, MACHINE_DEFAULT_ACCELERATION: 1000,
                MACHINE_DEFAULT_MINSEGMENTTIME: 20000, MACHINE_DEFAULT_XYJERK: 20, MACHINE_DEFAULT_ZJERK: 0.2, MACHINE_GENERATE_FRAME_TIME: 450,
                MACHINE_MAX_ACCELERATION: [1000, 1000, 160, 1000], MACHINE_MAX_FEEDRATE: [200, 200, 20, 45], MACHINE_MAX_STEP_FREQUENCY: 256000,
                MACHINE_MINIMUM_PLANNER_SPEED: 0.5, MACHINE_NOR_LAYER_DOWN_HEIGHT_DIV: 0.25, MACHINE_NOR_LAYER_DOWN_SPEED_DIV: 0.5,
                MACHINE_NOR_LAYER_UP_HEIGHT_DIV: 0.25, MACHINE_NOR_LAYER_UP_SPEED_DIV: 0.5, MACHINE_STEP_MUL: 1, MACHINE_TIME_COMPENSATE: 0,
                MACHINE_TIM_PRES: 30, MACHINE_TIM_RCC_CLK: 60, FUNCTION: 1, MACHINE_MODE_ACCELERATION: [0, 0, 0, 0],
                LAYER_COMPENSATE: [0, 0, 0, 0], HEIGHT_COMPENSATE: [0, 0, 0, 0], TIMES_COMPENSATE: [0, 0, 0, 0],
            },
            firmware_calc_exp_time_paras: {
                precision_range_branch: [0, 5, 25], precision_per_volume: 5, precision_coeff_value: [0.024, 0.01, -0.2],
                energy_coeff: 0, machine_exposure_ton: 0.4,
            },
        },
    };
    add("anycubic_photon_resins.pwsp", JSON.stringify(settings, null, 2));

    const layersController = {
        count: n,
        paras: Array.from({ length: n }, (_, i) => ({
            exposure_time: layers[i].exposureTime ?? exposure,
            layer_index: i,
            layer_minheight: round4(i * layerHeight),
            layer_thickness: layerHeight,
            zup_height: liftHeight,
            zup_speed: liftSpeed,
        })),
    };
    add("layers_controller.conf", JSON.stringify(layersController, null, 2));

    add("lcd_function.json", JSON.stringify({
        models_processed_info: {
            models: [{ auto_support: 0, hollow: 0, makeronline_sourceid: -1, manual_support: 0, name: "", punch: 0, source_from: 0 }],
            scene_models_from: 0, slice_paras_process: 0, software_version: `${software} ${version}`,
        },
        rerf_function: { enable: false, model_name: "", model_type: 1, partition_exposure_array: [], partition_num: 0 },
    }, null, 2));

    add("print_info.json", JSON.stringify({
        model_layers_count: n, cost: 0, currency: "€", print_time: printTime, volume: volumeMl, weight: grams,
        sub_estimated_infos: [{ model_layers_count: n, estimated_cost: 0, estimated_cost_currency: "€", estimated_time: printTime, estimated_volume: volumeMl, estimated_weight: grams }],
    }, null, 2));

    add("software_info.conf", JSON.stringify({ mark: software, opengl: "3.3-CoreProfile", os: "browser", Version: version }, null, 2));

    // ---- binaries ----
    add("scene.slice", buildSceneSlice(infos, layerHeight, `${software} ${version}`));
    add("calc_layer_volumes.data", buildLayerVolumes(infos.map(l => l.area), layerHeight));

    // No directory entries: Photon Workshop / UVtools archives list files only.
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
