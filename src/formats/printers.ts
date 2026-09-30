import type { PhotonPrinterSettings } from "./anycubic";

export interface PrinterModel extends PhotonPrinterSettings {
    rotate180: boolean;
    fileFormat: "dlp" | "pm3" | "pm3m" | "pm3n" | "pmsq" | "pw0" | "pwma" | "pwmb" | "pwmo" | "pwms" | "pwmx" | "pws" | "photon" | "pwx" | "pm4u";
    /** File container: the classic binary "ANYCUBIC" file (default) or the ZIP-based format of the newer printers. */
    container?: "binary" | "zip";
}

/**
 * Printer definitions. `resolution` is [x, y] exactly as the file expects it.
 * Physical dimensions and file versions follow UVtools (AnycubicFile.cs).
 */
export const printerModels: { [key: string]: PrinterModel } = {
    'AnyCubic Photon Mono 2 (.pm3n)': {
        "fileVersion": [517, 9],
        "xyRes": 0.035,
        "resolution": [4096, 2560],
        "physicalDimensions": [143.36, 89.60, 165.0],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "pm3n"
    },
    'AnyCubic Photon Mono 4 Ultra (.pm4u)': {
        "fileVersion": [518, 11],
        "xyRes": 0.017,
        "resolution": [9024, 5120],
        "physicalDimensions": [153.408, 87.04, 165.0],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "pm4u",
        "container": "zip"
    },
    'AnyCubic Photon Ultra (.dlp)': {
        "fileVersion": [515, 5],
        "xyRes": 0.080,
        "resolution": [1280, 720],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "dlp"
    },
    'AnyCubic Photon M3 (.pm3)': {
        "fileVersion": [516, 8],
        "xyRes": 0.040,
        "resolution": [4096, 2560],
        "physicalDimensions": [163.92, 102.4, 180.0],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "pm3"
    },
    'AnyCubic Photon M3 Max (.pm3m)': {
        "fileVersion": [516, 8],
        "xyRes": 0.046,
        "resolution": [6480, 3600],
        "physicalDimensions": [298.08, 165.6, 300.0],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "pm3m"
    },
    'AnyCubic Photon Mono SQ (.pwsq)': {
        "fileVersion": [515, 5],
        "xyRes": 0.050,
        "resolution": [2400, 2560],
        "previewResolution": [224, 168],
        "rotate180": false,
        "encoding": "RLE4",
        "fileFormat": "pmsq"
    },
    'AnyCubic Photon Zero (.pw0)': {
        "fileVersion": [1, 4],
        "xyRes": 0.1155,
        "resolution": [480, 854],
        "previewResolution": [224, 168],
        "rotate180": false,
        "encoding": "RLE4",
        "fileFormat": "pw0"
    },
    'AnyCubic Photon Mono 4K (.pwma)': {
        "fileVersion": [516, 8],
        "xyRes": 0.035,
        "resolution": [3840, 2400],
        "physicalDimensions": [134.4, 84.0, 165.0],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "pwma"
    },
    'AnyCubic Photon Mono X 6K & Photon M3 Plus (.pwmb)': {
        "fileVersion": [516, 8],
        "xyRes": 0.0344,
        "resolution": [5760, 3600],
        "physicalDimensions": [197.0, 122.8, 245.0],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "pwmb"
    },
    'AnyCubic Photon Mono (.pwmo)': {
        "fileVersion": [1, 4],
        "xyRes": 0.051,
        "resolution": [1620, 2560],
        "previewResolution": [224, 168],
        "rotate180": false,
        "encoding": "RLE4",
        "fileFormat": "pwmo"
    },
    'AnyCubic Photon Mono SE (.pwms)': {
        "fileVersion": [1, 4],
        "xyRes": 0.051,
        "resolution": [1620, 2560],
        "previewResolution": [224, 168],
        "rotate180": false,
        "encoding": "RLE4",
        "fileFormat": "pwms"
    },
    'AnyCubic Photon Mono X (.pwmx)': {
        "fileVersion": [1, 4],
        "xyRes": 0.050,
        "resolution": [3840, 2400],
        "previewResolution": [224, 168],
        "rotate180": false,
        "encoding": "RLE4",
        "fileFormat": "pwmx"
    },
    'AnyCubic Photon & Photon S (.pws)': {
        "fileVersion": [1, 4],
        "xyRes": 0.047,
        "resolution": [1440, 2560],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE",
        "fileFormat": "pws"
    },
    'AnyCubic Photon X (.pwx)': {
        "fileVersion": [1, 4],
        "xyRes": 0.075,
        "resolution": [2560, 1600],
        "previewResolution": [224, 168],
        "rotate180": true,
        "encoding": "RLE4",
        "fileFormat": "pwx"
    },
};

/** Machine name string written into the MACHINE section, derived from the display name. */
export function machineNameFor(displayName: string): string {
    return displayName.replace("AnyCubic ", "").replace(/ \(.*\)$/, "").split(" & ")[0];
}
