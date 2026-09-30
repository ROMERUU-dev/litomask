import {
    normalizeBridgeUrl, isMixedContent, sanitizeFileName, toBridgeFileName, formatBytes, shouldProbeOrigin,
    BridgeClient, BridgeError, BRIDGE_EXTENSIONS, DEFAULT_BRIDGE_URL,
} from "../printerLink";

describe("normalizeBridgeUrl", () => {
    test("adds the http scheme and the default port 8080 to a bare host", () => {
        expect(normalizeBridgeUrl("litomask.local")).toBe("http://litomask.local:8080");
        expect(normalizeBridgeUrl("192.168.1.20")).toBe("http://192.168.1.20:8080");
        expect(normalizeBridgeUrl("[fe80::1]")).toBe("http://[fe80::1]:8080");
    });

    test("a full URL is respected as typed (no port added: it may be a proxy on port 80)", () => {
        expect(normalizeBridgeUrl("http://litomask.local")).toBe("http://litomask.local");
        expect(normalizeBridgeUrl("http://192.168.1.20/")).toBe("http://192.168.1.20");
    });

    test("keeps an explicit port, including the scheme default", () => {
        expect(normalizeBridgeUrl("192.168.1.20:8080")).toBe("http://192.168.1.20:8080");
        expect(normalizeBridgeUrl("localhost:5174")).toBe("http://localhost:5174");
        expect(normalizeBridgeUrl("http://litomask.local:80")).toBe("http://litomask.local:80");
        expect(normalizeBridgeUrl("[fe80::1]:9000")).toBe("http://[fe80::1]:9000");
    });

    test("https gets no default port", () => {
        expect(normalizeBridgeUrl("https://pi.example.org")).toBe("https://pi.example.org");
        expect(normalizeBridgeUrl("https://pi.example.org:8443/")).toBe("https://pi.example.org:8443");
    });

    test("strips whitespace, trailing slashes, query, /api paths and lowercases the host", () => {
        expect(normalizeBridgeUrl("  http://litomask.local:8080///  ")).toBe("http://litomask.local:8080");
        expect(normalizeBridgeUrl("HTTP://LitoMask.LOCAL:8080/api/status")).toBe("http://litomask.local:8080");
        expect(normalizeBridgeUrl("http://litomask.local:8080/api")).toBe("http://litomask.local:8080");
        expect(normalizeBridgeUrl("http://litomask.local:8080/?x=1#y")).toBe("http://litomask.local:8080");
        expect(normalizeBridgeUrl("http://litomask.local:8080/litomask/")).toBe("http://litomask.local:8080/litomask");
    });

    test("empty input stays empty", () => {
        expect(normalizeBridgeUrl("")).toBe("");
        expect(normalizeBridgeUrl("   ")).toBe("");
    });

    test("the default URL is already normalized", () => {
        expect(normalizeBridgeUrl(DEFAULT_BRIDGE_URL)).toBe(DEFAULT_BRIDGE_URL);
    });
});

describe("isMixedContent", () => {
    test("https page and http bridge is mixed content", () => {
        expect(isMixedContent("https:", "http://litomask.local:8080")).toBe(true);
        expect(isMixedContent("https", "litomask.local")).toBe(true);
        expect(isMixedContent("HTTPS:", "192.168.1.20:8080")).toBe(true);
    });

    test("http page is never mixed content", () => {
        expect(isMixedContent("http:", "http://litomask.local:8080")).toBe(false);
        expect(isMixedContent("http:", "https://pi.example.org")).toBe(false);
        expect(isMixedContent("file:", "litomask.local")).toBe(false);
    });

    test("https bridge or local host from an https page is fine", () => {
        expect(isMixedContent("https:", "https://pi.example.org")).toBe(false);
        expect(isMixedContent("https:", "http://localhost:8080")).toBe(false);
        expect(isMixedContent("https:", "127.0.0.1:8080")).toBe(false);
        expect(isMixedContent("https:", "")).toBe(false);
    });
});

describe("sanitizeFileName", () => {
    test("accepts valid basenames with a printer extension (case-insensitive)", () => {
        expect(sanitizeFileName("mascara_A.pm3n")).toBe("mascara_A.pm3n");
        expect(sanitizeFileName("calib.PM3N")).toBe("calib.PM3N");
        expect(sanitizeFileName("a.zip")).toBe("a.zip");
        expect(sanitizeFileName("1.pw0")).toBe("1.pw0");
        expect(sanitizeFileName("a-b_c.d.pm4u")).toBe("a-b_c.d.pm4u");
        expect(sanitizeFileName("x.png")).toBe("x.png");
        for (const ext of BRIDGE_EXTENSIONS) expect(sanitizeFileName(`f.${ext}`)).toBe(`f.${ext}`);
    });

    test("accepts exactly 100 characters and rejects 101", () => {
        const ok = "a".repeat(95) + ".pm3n";
        expect(ok.length).toBe(100);
        expect(sanitizeFileName(ok)).toBe(ok);
        expect(sanitizeFileName("a" + ok)).toBeNull();
    });

    test("rejects traversal and paths", () => {
        expect(sanitizeFileName("../x.pm3n")).toBeNull();
        expect(sanitizeFileName("..")).toBeNull();
        expect(sanitizeFileName("x..pm3n")).toBeNull();
        expect(sanitizeFileName("a/../b.pm3n")).toBeNull();
        expect(sanitizeFileName("dir/x.pm3n")).toBeNull();
        expect(sanitizeFileName("dir\\x.pm3n")).toBeNull();
        expect(sanitizeFileName("/x.pm3n")).toBeNull();
    });

    test("rejects wrong or missing extensions", () => {
        expect(sanitizeFileName("x.exe")).toBeNull();
        expect(sanitizeFileName("x.pm3n.txt")).toBeNull();
        expect(sanitizeFileName("x")).toBeNull();
        expect(sanitizeFileName("x.")).toBeNull();
        expect(sanitizeFileName(".pm3n")).toBeNull();
    });

    test("rejects characters outside the allowed set and bad first characters", () => {
        expect(sanitizeFileName("")).toBeNull();
        expect(sanitizeFileName("má.pm3n")).toBeNull();
        expect(sanitizeFileName("a b.pm3n")).toBeNull();
        expect(sanitizeFileName(" a.pm3n")).toBeNull();
        expect(sanitizeFileName("-x.pm3n")).toBeNull();
        expect(sanitizeFileName("_x.pm3n")).toBeNull();
        expect(sanitizeFileName("x;rm.pm3n")).toBeNull();
        expect(sanitizeFileName("Кириллица.pm3n")).toBeNull();
    });
});

describe("toBridgeFileName", () => {
    test("removes diacritics and replaces the rest with underscores", () => {
        expect(toBridgeFileName("máscara_A.pm3n")).toBe("mascara_A.pm3n");
        expect(toBridgeFileName("mi diseño (v2).pm3n")).toBe("mi_diseno_v2.pm3n");
        expect(toBridgeFileName("calibracion_matriz_dosis_3s_x10.pm3n")).toBe("calibracion_matriz_dosis_3s_x10.pm3n");
        expect(toBridgeFileName("x..pm3n")).toBe("x.pm3n");
        expect(toBridgeFileName("mi..diseño...v2.pm3n")).toBe("mi.diseno.v2.pm3n");
        expect(toBridgeFileName("_a.PM4U")).toBe("a.PM4U");
    });

    test("falls back to a default stem and keeps only the basename", () => {
        expect(toBridgeFileName("Кириллица.pm3n")).toBe("litomask.pm3n");
        expect(toBridgeFileName("Кириллица_A.pm3n")).toBe("A.pm3n");
        expect(toBridgeFileName("dir/sub/x.pm3n")).toBe("x.pm3n");
    });

    test("truncates long names keeping the extension", () => {
        const long = "b".repeat(150) + ".pm4u";
        const r = toBridgeFileName(long);
        expect(r).not.toBeNull();
        expect(r!.length).toBe(100);
        expect(r!.endsWith(".pm4u")).toBe(true);
    });

    test("rejects extensions the bridge does not accept", () => {
        expect(toBridgeFileName("x.exe")).toBeNull();
        expect(toBridgeFileName("noext")).toBeNull();
    });
});

describe("formatBytes", () => {
    test("uses decimal units", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(999)).toBe("999 B");
        expect(formatBytes(1500)).toBe("1.5 kB");
        expect(formatBytes(123456789)).toBe("123 MB");
        expect(formatBytes(2.5e9)).toBe("2.5 GB");
        expect(formatBytes(-1)).toBe("?");
    });
});

describe("shouldProbeOrigin", () => {
    test("skips GitHub Pages, the Vite dev server and non-http pages", () => {
        expect(shouldProbeOrigin({ protocol: "https:", hostname: "romeruu-dev.github.io", port: "" })).toBe(false);
        expect(shouldProbeOrigin({ protocol: "http:", hostname: "localhost", port: "5174" })).toBe(false);
        expect(shouldProbeOrigin({ protocol: "http:", hostname: "localhost", port: "5173" })).toBe(false);
        expect(shouldProbeOrigin({ protocol: "file:", hostname: "", port: "" })).toBe(false);
    });

    test("probes a page served from the Pi or another LAN host", () => {
        expect(shouldProbeOrigin({ protocol: "http:", hostname: "litomask.local", port: "8080" })).toBe(true);
        expect(shouldProbeOrigin({ protocol: "http:", hostname: "192.168.1.20", port: "8080" })).toBe(true);
        expect(shouldProbeOrigin({ protocol: "http:", hostname: "localhost", port: "8080" })).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------------

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }, calls: Call[] = []): typeof fetch {
    return async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        const r = handler(url, init);
        const text = r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
        return new Response(text, { status: r.status, headers: { "Content-Type": "application/json" } });
    };
}

const statusBody = {
    ok: true, service: "litomask-usb", version: "1.0", mode: "gadget", exported: true, label: "LITOMASK",
    free_bytes: 1000, total_bytes: 2000, files: [{ name: "a.pm3n", size: 10, mtime: 1 }],
};

describe("BridgeClient", () => {
    test("status() hits /api/status on the normalized base URL and parses the answer", async () => {
        const calls: Call[] = [];
        const c = new BridgeClient("litomask.local", { fetchFn: fakeFetch(() => ({ status: 200, body: statusBody }), calls) });
        const s = await c.status();
        expect(calls[0].url).toBe("http://litomask.local:8080/api/status");
        expect(calls[0].init?.method).toBe("GET");
        expect(s.mode).toBe("gadget");
        expect(s.free_bytes).toBe(1000);
        expect(s.files).toHaveLength(1);
    });

    test("status() rejects a server that is not the bridge", async () => {
        const c = new BridgeClient("http://example.org", { fetchFn: fakeFetch(() => ({ status: 200, body: { hello: "world" } })) });
        await expect(c.status()).rejects.toMatchObject({ code: "not_bridge" });
    });

    test("network failures become a BridgeError with status 0", async () => {
        const c = new BridgeClient("litomask.local", { fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
        const err = await c.status().catch(e => e);
        expect(err).toBeInstanceOf(BridgeError);
        expect(err.code).toBe("network");
        expect(err.status).toBe(0);
    });

    test("upload() PUTs raw bytes with application/octet-stream", async () => {
        const calls: Call[] = [];
        const c = new BridgeClient("192.168.1.20:8080", { fetchFn: fakeFetch(() => ({ status: 200, body: { ok: true, name: "m.pm3n", size: 4 } }), calls) });
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const progress: number[] = [];
        const r = await c.upload("m.pm3n", bytes, (s, total) => progress.push(s / total));
        const init = calls[0].init!;
        expect(calls[0].url).toBe("http://192.168.1.20:8080/api/files/m.pm3n");
        expect(init.method).toBe("PUT");
        expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/octet-stream");
        expect((init.body as ArrayBuffer).byteLength).toBe(4);
        expect(r).toEqual({ name: "m.pm3n", size: 4 });
        expect(progress).toEqual([1]);
    });

    test("upload() refuses invalid names without calling the network", async () => {
        const calls: Call[] = [];
        const c = new BridgeClient("litomask.local", { fetchFn: fakeFetch(() => ({ status: 200, body: { ok: true } }), calls) });
        await expect(c.upload("../evil.pm3n", new ArrayBuffer(1))).rejects.toMatchObject({ code: "bad_name" });
        await expect(c.upload("x.exe", new ArrayBuffer(1))).rejects.toMatchObject({ code: "bad_name" });
        expect(calls).toHaveLength(0);
    });

    test("HTTP errors carry the status and the JSON error message", async () => {
        const c = new BridgeClient("litomask.local", { fetchFn: fakeFetch(() => ({ status: 409, body: { ok: false, error: "another write in progress" } })) });
        const err = await c.upload("m.pm3n", new ArrayBuffer(1)).catch(e => e);
        expect(err).toBeInstanceOf(BridgeError);
        expect(err.code).toBe("busy");
        expect(err.status).toBe(409);
        expect(err.detail).toBe("another write in progress");
        expect(err.message).toBe("HTTP 409: another write in progress");

        const full = new BridgeClient("litomask.local", { fetchFn: fakeFetch(() => ({ status: 507, body: { ok: false, error: "no space" } })) });
        await expect(full.upload("m.pm3n", new ArrayBuffer(1))).rejects.toMatchObject({ code: "no_space", status: 507 });
    });

    test("remove() DELETEs and maps 404 to not_found with the file name", async () => {
        const calls: Call[] = [];
        const c = new BridgeClient("litomask.local", { fetchFn: fakeFetch(url => url.endsWith("/gone.pm3n") ? { status: 404, body: { ok: false } } : { status: 200, body: { ok: true } }, calls) });
        await c.remove("a.pm3n");
        expect(calls[0].url).toBe("http://litomask.local:8080/api/files/a.pm3n");
        expect(calls[0].init?.method).toBe("DELETE");
        await expect(c.remove("gone.pm3n")).rejects.toMatchObject({ code: "not_found", status: 404, fileName: "gone.pm3n" });
    });

    test("not_found keeps the server message in detail and the file in fileName", async () => {
        const c = new BridgeClient("litomask.local", { fetchFn: fakeFetch(() => ({ status: 404, body: { ok: false, error: "el archivo no existe" } })) });
        await expect(c.remove("gone.pm3n")).rejects.toMatchObject({ code: "not_found", detail: "el archivo no existe", fileName: "gone.pm3n" });
    });

    test("status() treats a 404 (another web server at that address) as not_bridge and drops HTML bodies", async () => {
        const c = new BridgeClient("http://example.org:8000", { fetchFn: fakeFetch(() => ({ status: 404, body: "<html><body>Not Found</body></html>" })) });
        const err = await c.status().catch(e => e);
        expect(err).toBeInstanceOf(BridgeError);
        expect(err.code).toBe("not_bridge");
        expect(err.detail).toBe("");
    });

    test("a plain-text error body becomes the detail, an HTML one does not", async () => {
        const txt = new BridgeClient("litomask.local", { fetchFn: fakeFetch(() => ({ status: 500, body: "boom" })) });
        await expect(txt.remove("a.pm3n")).rejects.toMatchObject({ code: "http", status: 500, detail: "boom" });
        const html = new BridgeClient("litomask.local", { fetchFn: fakeFetch(() => ({ status: 502, body: "<html>bad gateway</html>" })) });
        await expect(html.remove("a.pm3n")).rejects.toMatchObject({ code: "http", status: 502, detail: "" });
    });

    test("a bridge that never answers times out through the AbortController signal", async () => {
        const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
        const c = new BridgeClient("litomask.local", { timeoutMs: 20, fetchFn: hanging });
        const err = await c.status().catch(e => e);
        expect(err).toBeInstanceOf(BridgeError);
        expect(err.code).toBe("timeout");
        expect(err.status).toBe(0);
    });

    test("upload() uses XMLHttpRequest with progress when it exists", async () => {
        const record: { method?: string; url?: string; headers: Record<string, string>; body?: ArrayBuffer } = { headers: {} };
        class FakeXhr {
            status = 200;
            responseText = JSON.stringify({ ok: true, name: "m.pm3n", size: 4 });
            responseType = "";
            upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            onabort: (() => void) | null = null;
            ontimeout: (() => void) | null = null;
            open(method: string, url: string) { record.method = method; record.url = url; }
            setRequestHeader(k: string, v: string) { record.headers[k] = v; }
            abort() { this.onabort?.(); }
            send(body: ArrayBuffer) {
                record.body = body;
                setTimeout(() => {
                    this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 });
                    this.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 });
                    this.onload?.();
                }, 0);
            }
        }
        vi.stubGlobal("XMLHttpRequest", FakeXhr);
        try {
            const c = new BridgeClient("litomask.local", { fetchFn: async () => { throw new Error("fetch must not be used"); } });
            const progress: number[] = [];
            const r = await c.upload("m.pm3n", new Uint8Array([1, 2, 3, 4]), (s, total) => progress.push(s / total));
            expect(record.method).toBe("PUT");
            expect(record.url).toBe("http://litomask.local:8080/api/files/m.pm3n");
            expect(record.headers["Content-Type"]).toBe("application/octet-stream");
            expect(record.body?.byteLength).toBe(4);
            expect(progress).toEqual([0.5, 1]);
            expect(r).toEqual({ name: "m.pm3n", size: 4 });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    test("upload() over XMLHttpRequest aborts with timeout when no byte moves for uploadIdleMs", async () => {
        class StuckXhr {
            status = 0;
            responseText = "";
            responseType = "";
            upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            onabort: (() => void) | null = null;
            ontimeout: (() => void) | null = null;
            open() { /* nada */ }
            setRequestHeader() { /* nada */ }
            abort() { this.onabort?.(); }
            send() { /* nunca responde */ }
        }
        vi.stubGlobal("XMLHttpRequest", StuckXhr);
        try {
            const c = new BridgeClient("litomask.local", { uploadIdleMs: 20 });
            const err = await c.upload("m.pm3n", new ArrayBuffer(1)).catch(e => e);
            expect(err).toBeInstanceOf(BridgeError);
            expect(err.code).toBe("timeout");
            expect(err.fileName).toBe("m.pm3n");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    test("reconnect() POSTs to /api/reconnect and listFiles() reads /api/files", async () => {
        const calls: Call[] = [];
        const c = new BridgeClient("litomask.local", {
            fetchFn: fakeFetch(url => url.endsWith("/api/reconnect") ? { status: 200, body: { ok: true, exported: true } } : { status: 200, body: { files: [{ name: "b.pm3n", size: 1, mtime: 2 }] } }, calls),
        });
        expect(await c.reconnect()).toEqual({ exported: true });
        expect(calls[0].url).toBe("http://litomask.local:8080/api/reconnect");
        expect(calls[0].init?.method).toBe("POST");
        expect(await c.listFiles()).toEqual([{ name: "b.pm3n", size: 1, mtime: 2 }]);
        expect(calls[1].url).toBe("http://litomask.local:8080/api/files");
    });
});
