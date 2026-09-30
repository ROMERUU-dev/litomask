/**
 * Cliente del "puente USB": una Raspberry Pi enchufada a la impresora que se comporta como una
 * memoria USB y expone una pequeña API HTTP (ver pi/README.md). Lógica pura, sin DOM ni React:
 * solo fetch y, para el progreso de subida, XMLHttpRequest cuando existe.
 *
 * Contrato HTTP (debe coincidir EXACTAMENTE con el servicio de la Pi):
 *   GET    /api/status        -> BridgeStatus
 *   GET    /api/files         -> { files: BridgeFile[] }
 *   PUT    /api/files/{name}  -> { ok, name, size }  (cuerpo en bruto, application/octet-stream)
 *   DELETE /api/files/{name}  -> { ok }              (404 si no existe)
 *   POST   /api/reconnect     -> { ok, exported }    (desconecta y vuelve a exponer la memoria)
 * Errores: 400 nombre inválido, 409 ocupado, 413/507 sin espacio; cuerpo {ok:false, error}.
 */

export const DEFAULT_BRIDGE_PORT = 8080;
export const DEFAULT_BRIDGE_URL = `http://litomask.local:${DEFAULT_BRIDGE_PORT}`;
/** Clave de localStorage donde la interfaz recuerda la dirección del puente. */
export const BRIDGE_STORAGE_KEY = "litomask.bridgeUrl";

/** Extensiones que el servicio acepta (sin punto, en minúsculas). */
export const BRIDGE_EXTENSIONS: readonly string[] = [
    "pm3n", "pm4u", "pwmx", "pwma", "pwmb", "pwmo", "pwms", "pws", "pwx", "pw0", "pm3", "pm3m",
    "pmsq", "dlp", "pm4n", "pm7", "pm7m", "pwsz", "ctb", "goo", "prz", "zip", "png",
];

/** Misma regla que el servicio: solo basename, ASCII, empieza por alfanumérico, máximo 100 caracteres. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_NAME = 100;

export interface BridgeFile { name: string; size: number; mtime: number }

export interface BridgeStatus {
    ok: true;
    service: string;
    version: string;
    mode: "gadget" | "dev";
    exported: boolean;
    label: string;
    free_bytes: number;
    total_bytes: number;
    files: BridgeFile[];
}

/** Archivo de impresora ya construido, listo para descargar o subir al puente. */
export interface OutputFile { fileName: string; bytes: ArrayBuffer }

export type BridgeErrorCode = "network" | "timeout" | "not_bridge" | "bad_name" | "busy" | "no_space" | "not_found" | "http";

/**
 * Error del puente. `status` es el código HTTP (0 si no hubo respuesta), `detail` el campo
 * `error` del JSON de respuesta (o el mensaje de red) y `fileName` el archivo implicado, si lo hay.
 */
export class BridgeError extends Error {
    readonly code: BridgeErrorCode;
    readonly status: number;
    readonly detail: string;
    readonly fileName: string;

    constructor(code: BridgeErrorCode, status: number, detail = "", fileName = "") {
        super(status > 0 ? `HTTP ${status}${detail ? `: ${detail}` : ""}` : `${code}${detail ? `: ${detail}` : ""}`);
        this.name = "BridgeError";
        this.code = code;
        this.status = status;
        this.detail = detail;
        this.fileName = fileName;
    }
}

/**
 * Normaliza lo que escribe el usuario como dirección del puente:
 *   "litomask.local"          -> "http://litomask.local:8080"  (sin esquema: puerto por defecto)
 *   "192.168.1.20:8080"       -> "http://192.168.1.20:8080"
 *   "http://litomask.local"   -> "http://litomask.local"       (URL completa: se respeta tal cual)
 *   "https://pi.example.org"  -> "https://pi.example.org"
 *   "http://x:8080/api/status" -> "http://x:8080"              (rutas /api pegadas del navegador)
 * Quita espacios, barras finales, consulta y fragmento; pone el host en minúsculas.
 * Devuelve "" para una entrada vacía.
 */
export function normalizeBridgeUrl(input: string): string {
    let s = (input ?? "").trim();
    if (!s) return "";
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
    if (!hasScheme) s = `http://${s}`;
    let u: URL;
    try { u = new URL(s); } catch { return s.replace(/\/+$/, ""); }
    const proto = u.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return s.replace(/\/+$/, "");

    // La clase URL omite el puerto por defecto (":80" / ":443"); lo respetamos si venía escrito.
    const authority = s.slice(s.indexOf("//") + 2).split(/[/?#]/, 1)[0];
    const explicit = /:(\d+)$/.exec(authority);
    let port = explicit ? explicit[1] : u.port;
    if (!port && !hasScheme) port = String(DEFAULT_BRIDGE_PORT);

    let path = u.pathname.replace(/\/+$/, "");
    if (path === "/api" || path.startsWith("/api/")) path = "";
    return `${proto}//${u.hostname}${port ? `:${port}` : ""}${path}`;
}

/**
 * true cuando la página se sirve por HTTPS y el puente es http://: el navegador bloquea la
 * petición ("mixed content"). Los hosts locales (localhost, 127.0.0.1, [::1]) se consideran
 * seguros, como hacen Chrome y Firefox.
 */
export function isMixedContent(pageProtocol: string, bridgeUrl: string): boolean {
    const page = (pageProtocol ?? "").trim().toLowerCase().replace(/:$/, "");
    if (page !== "https") return false;
    const url = normalizeBridgeUrl(bridgeUrl);
    if (!/^http:\/\//i.test(url)) return false;
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { return true; }
    return !(host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]");
}

/**
 * Comprueba un nombre contra la regla del servicio y lo devuelve tal cual si es válido; null si no.
 * No lo modifica: para adaptar un nombre libre usa `toBridgeFileName`.
 */
export function sanitizeFileName(name: string): string | null {
    if (typeof name !== "string" || !name) return null;
    if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
    if (!NAME_RE.test(name)) return null;
    const dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) return null;
    const ext = name.slice(dot + 1).toLowerCase();
    return BRIDGE_EXTENSIONS.includes(ext) ? name : null;
}

/**
 * Adapta un nombre generado por la app (puede llevar acentos, espacios, paréntesis...) a la
 * regla del servicio: quita diacríticos, sustituye lo demás por "_", colapsa los puntos
 * seguidos y recorta a 100 caracteres conservando la extensión. Devuelve null si aun así no es
 * válido (p. ej. extensión no admitida).
 */
export function toBridgeFileName(name: string): string | null {
    const base = (name ?? "").split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    if (dot < 0) return null;
    const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
    let stem = ascii(base.slice(0, dot)).replace(/\.{2,}/g, ".").replace(/^[^A-Za-z0-9]+/, "").replace(/[._-]+$/, "");
    const ext = ascii(base.slice(dot + 1)).replace(/[^A-Za-z0-9]/g, "");
    if (!stem) stem = "litomask";
    if (stem.length + 1 + ext.length > MAX_NAME) stem = stem.slice(0, MAX_NAME - 1 - ext.length).replace(/[._-]+$/, "");
    return sanitizeFileName(`${stem}.${ext}`);
}

/** "1.5 kB", "123 MB"... (unidades decimales, como las anuncian las memorias USB). */
export function formatBytes(n: number): string {
    if (!isFinite(n) || n < 0) return "?";
    const units = ["B", "kB", "MB", "GB", "TB"];
    let v = n, i = 0;
    while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
    const txt = i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1);
    return `${txt} ${units[i]}`;
}

/**
 * ¿Merece la pena probar `origin/api/status` al arrancar? No cuando la app se sirve desde
 * GitHub Pages (github.io) ni desde el servidor de desarrollo de Vite (localhost:5173/5174).
 */
export function shouldProbeOrigin(loc: { protocol: string; hostname: string; port: string }): boolean {
    const proto = (loc.protocol ?? "").toLowerCase().replace(/:$/, "");
    if (proto !== "http" && proto !== "https") return false;
    const host = (loc.hostname ?? "").toLowerCase();
    if (!host || host.endsWith("github.io")) return false;
    const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    if (local && (loc.port === "5173" || loc.port === "5174")) return false;
    return true;
}

// ---------------------------------------------------------------------------------------------

export interface BridgeClientOptions {
    /** Tiempo máximo de espera de status/list/delete (ms). 0 = sin límite. */
    timeoutMs?: number;
    /** Subida: si pasan estos ms sin que avance ningún byte, se aborta con `timeout`. 0 = sin límite. */
    uploadIdleMs?: number;
    /** Sustituto de fetch (pruebas). */
    fetchFn?: typeof fetch;
}

function parseJson(text: string): unknown {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

function jsonError(json: unknown): string {
    if (json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string") {
        return (json as { error: string }).error;
    }
    return "";
}

/** Detalle legible de una respuesta de error: el `error` del JSON o, si el cuerpo es texto plano, su inicio. */
function errorFromResponse(status: number, json: unknown, text: string, fileName = ""): BridgeError {
    const plain = text.trim();
    const detail = jsonError(json) || (json === null && !plain.startsWith("<") ? plain.slice(0, 200) : "");
    const code: BridgeErrorCode =
        status === 400 ? "bad_name" :
            status === 404 ? "not_found" :
                status === 409 ? "busy" :
                    status === 413 || status === 507 ? "no_space" : "http";
    return new BridgeError(code, status, detail, fileName);
}

function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (bytes instanceof ArrayBuffer) return bytes;
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

/**
 * PUT con progreso real de subida (XMLHttpRequest; fetch no lo expone). Sin límite de tiempo
 * total (los archivos pueden ser grandes), pero se aborta si no avanza ningún byte en `idleMs`.
 */
function uploadXhr(url: string, body: ArrayBuffer, fileName: string, idleMs: number, onProgress?: (sent: number, total: number) => void): Promise<{ name: string; size: number }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let idle = false;
        const clear = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
        const arm = () => {
            clear();
            if (idleMs > 0) timer = setTimeout(() => { idle = true; xhr.abort(); }, idleMs);
        };
        xhr.open("PUT", url, true);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.responseType = "text";
        xhr.upload.onprogress = (ev) => {
            arm();
            if (ev.lengthComputable) onProgress?.(ev.loaded, ev.total);
        };
        xhr.onerror = () => { clear(); reject(new BridgeError("network", 0, "upload", fileName)); };
        xhr.onabort = () => { clear(); reject(new BridgeError(idle ? "timeout" : "network", 0, idle ? "upload idle" : "abort", fileName)); };
        xhr.ontimeout = () => { clear(); reject(new BridgeError("timeout", 0, "upload", fileName)); };
        xhr.onload = () => {
            clear();
            const text = typeof xhr.responseText === "string" ? xhr.responseText : "";
            const json = parseJson(text);
            if (xhr.status >= 200 && xhr.status < 300) {
                const r = (json ?? {}) as { name?: string; size?: number };
                resolve({ name: r.name ?? fileName, size: r.size ?? body.byteLength });
            } else {
                reject(errorFromResponse(xhr.status, json, text, fileName));
            }
        };
        arm();
        xhr.send(body);
    });
}

export class BridgeClient {
    readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly uploadIdleMs: number;
    private readonly fetchFn: typeof fetch;

    constructor(baseUrl: string, opts: BridgeClientOptions = {}) {
        this.baseUrl = normalizeBridgeUrl(baseUrl) || DEFAULT_BRIDGE_URL;
        this.timeoutMs = opts.timeoutMs ?? 8000;
        this.uploadIdleMs = opts.uploadIdleMs ?? 30000;
        this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    }

    private async request(method: string, path: string, opts: { body?: ArrayBuffer; timeoutMs?: number; fileName?: string } = {}): Promise<unknown> {
        const ms = opts.timeoutMs ?? this.timeoutMs;
        const ctrl = new AbortController();
        let timedOut = false;
        const timer = ms > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, ms) : undefined;
        try {
            let res: Response;
            try {
                res = await this.fetchFn(this.baseUrl + path, {
                    method,
                    body: opts.body,
                    headers: opts.body !== undefined ? { "Content-Type": "application/octet-stream" } : undefined,
                    signal: ctrl.signal,
                });
            } catch (e) {
                const err = e as Error;
                const aborted = timedOut || err?.name === "TimeoutError" || err?.name === "AbortError";
                throw new BridgeError(aborted ? "timeout" : "network", 0, String(err?.message ?? e), opts.fileName);
            }
            let text = "";
            try { text = await res.text(); } catch (e) {
                throw new BridgeError(timedOut ? "timeout" : "network", 0, String((e as Error)?.message ?? e), opts.fileName);
            }
            const json = parseJson(text);
            if (!res.ok) throw errorFromResponse(res.status, json, text, opts.fileName);
            return json;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    /**
     * Estado del puente. Lanza `not_bridge` si responde algo que no es el servicio litomask-usb
     * (incluido un 404/400 de otro servidor web que viva en esa dirección).
     */
    async status(): Promise<BridgeStatus> {
        let j: Partial<BridgeStatus> | null;
        try {
            j = (await this.request("GET", "/api/status")) as Partial<BridgeStatus> | null;
        } catch (e) {
            if (e instanceof BridgeError && (e.code === "not_found" || e.code === "bad_name")) throw new BridgeError("not_bridge", e.status, e.detail);
            throw e;
        }
        if (!j || typeof j !== "object" || j.ok !== true || j.service !== "litomask-usb") throw new BridgeError("not_bridge", 200, "");
        return {
            ok: true,
            service: j.service,
            version: String(j.version ?? ""),
            mode: j.mode === "dev" ? "dev" : "gadget",
            exported: !!j.exported,
            label: String(j.label ?? ""),
            free_bytes: Number(j.free_bytes ?? 0),
            total_bytes: Number(j.total_bytes ?? 0),
            files: Array.isArray(j.files) ? j.files : [],
        };
    }

    async listFiles(): Promise<BridgeFile[]> {
        const j = (await this.request("GET", "/api/files")) as { files?: BridgeFile[] } | null;
        return Array.isArray(j?.files) ? j.files : [];
    }

    /** Sube un archivo (PUT en bruto). `onProgress(sent, total)` en bytes. */
    async upload(name: string, bytes: ArrayBuffer | Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<{ name: string; size: number }> {
        const safe = sanitizeFileName(name);
        if (!safe) throw new BridgeError("bad_name", 0, "", name);
        const path = `/api/files/${encodeURIComponent(safe)}`;
        const body = toArrayBuffer(bytes);
        if (typeof XMLHttpRequest !== "undefined") return uploadXhr(this.baseUrl + path, body, safe, this.uploadIdleMs, onProgress);
        const j = (await this.request("PUT", path, { body, timeoutMs: 0, fileName: safe })) as { name?: string; size?: number } | null;
        onProgress?.(body.byteLength, body.byteLength);
        return { name: j?.name ?? safe, size: j?.size ?? body.byteLength };
    }

    async remove(name: string): Promise<void> {
        const safe = sanitizeFileName(name);
        if (!safe) throw new BridgeError("bad_name", 0, "", name);
        await this.request("DELETE", `/api/files/${encodeURIComponent(safe)}`, { fileName: safe });
    }

    /** Desconecta y vuelve a exponer la memoria USB para que la impresora la relea (tarda unos segundos). */
    async reconnect(): Promise<{ exported: boolean }> {
        const j = (await this.request("POST", "/api/reconnect", { timeoutMs: this.timeoutMs > 0 ? Math.max(this.timeoutMs, 20000) : 0 })) as { exported?: boolean } | null;
        return { exported: !!j?.exported };
    }
}
