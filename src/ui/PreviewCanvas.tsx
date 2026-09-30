import { useEffect, useMemo, useRef, useState } from "react";
import type { Bitmap } from "../core/bitmap";
import { useI18n } from "../i18n";

export interface PreviewLayer {
    bitmap: Bitmap;
    /** Additive RGB colour for ON pixels. */
    color: [number, number, number];
    /** For greyscale bitmaps (aerial image): scale colour by pixel value. */
    grey?: boolean;
}

interface Props {
    layers: PreviewLayer[];
    width: number;
    height: number;
    pixelMm: number;
    /** Redraw trigger (e.g. layers identity). */
    version: number;
}

interface View { zoom: number; x: number; y: number }

/**
 * Full-resolution composite drawn to an offscreen canvas, then shown with zoom/pan.
 * Input: mouse wheel + drag on desktop, one-finger pan and two-finger pinch on touch screens.
 */
export default function PreviewCanvas(props: Props) {
    const { layers, width, height, pixelMm, version } = props;
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [view, setView] = useState<View>({ zoom: 0.2, x: 0, y: 0 });
    const [cursor, setCursor] = useState<{ px: number, py: number } | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const pointers = useRef(new Map<number, { x: number, y: number }>());
    const gesture = useRef<{ view: View, cx: number, cy: number, dist: number } | null>(null);

    // Very large screens (e.g. 9024 x 5120 on the Mono 4 Ultra) are composited at reduced
    // resolution to keep the preview canvas under ~16 Mpx of RGBA memory.
    const MAX_PREVIEW_PX = 16_000_000;
    const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_PREVIEW_PX)));
    const offscreen = useMemo(() => {
        const cw = Math.ceil(width / step), ch = Math.ceil(height / step);
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext("2d")!;
        const img = ctx.createImageData(cw, ch);
        const d = img.data;
        const n = cw * ch;
        for (let i = 0; i < n; i++) { d[i * 4] = 16; d[i * 4 + 1] = 16; d[i * 4 + 2] = 20; d[i * 4 + 3] = 255; }
        for (const layer of layers) {
            if (!layer.bitmap || layer.bitmap.width !== width || layer.bitmap.height !== height) continue;
            const src = layer.bitmap.data;
            const [r, g, b] = layer.color;
            for (let y = 0; y < ch; y++) {
                const sy = Math.min(height - 1, y * step);
                for (let x = 0; x < cw; x++) {
                    const sx = Math.min(width - 1, x * step);
                    // with step > 1 take the max over the skipped block so thin lines stay visible
                    let v = 0;
                    if (step === 1) v = src[sy * width + sx];
                    else {
                        for (let yy = sy; yy < Math.min(height, sy + step); yy++)
                            for (let xx = sx; xx < Math.min(width, sx + step); xx++) { const s = src[yy * width + xx]; if (s > v) v = s; }
                    }
                    if (layer.grey ? v <= 0 : v < 128) continue;
                    const f = layer.grey ? v / 255 : 1;
                    const i = y * cw + x;
                    d[i * 4] = Math.min(255, d[i * 4] + r * f);
                    d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] + g * f);
                    d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] + b * f);
                }
            }
        }
        ctx.putImageData(img, 0, 0);
        return c;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, width, height, step]);

    const fit = () => {
        const el = containerRef.current;
        if (!el || el.clientWidth === 0) return;
        const zoom = Math.min(el.clientWidth / width, el.clientHeight / height) * 0.97;
        setView({ zoom, x: (el.clientWidth - width * zoom) / 2, y: (el.clientHeight - height * zoom) / 2 });
    };

    // Track the container size (window resize, orientation change, layout change)
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Refit whenever the viewport size changes (first layout, window resize, phone rotation)
    useEffect(() => {
        if (size.w === 0) return;
        fit();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size.w, size.h, width, height]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || size.w === 0) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
        canvas.style.width = `${size.w}px`;
        canvas.style.height = `${size.h}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.w, size.h);
        ctx.imageSmoothingEnabled = view.zoom * dpr < 1;
        ctx.setTransform(dpr * view.zoom * step, 0, 0, dpr * view.zoom * step, dpr * view.x, dpr * view.y);
        ctx.drawImage(offscreen, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = "#888";
        ctx.lineWidth = 1;
        ctx.strokeRect(view.x, view.y, width * view.zoom, height * view.zoom);
        // scale bar: 1 mm or 10 mm, whichever fits nicely
        const barMm = view.zoom * (1 / pixelMm) > 60 ? 1 : 10;
        const barPx = barMm / pixelMm * view.zoom;
        ctx.fillStyle = "#fff";
        ctx.fillRect(12, size.h - 18, barPx, 3);
        ctx.font = "12px sans-serif";
        ctx.fillText(`${barMm} mm`, 12, size.h - 24);
    }, [view, offscreen, width, height, pixelMm, size, step]);

    const zoomAt = (factor: number, mx: number, my: number) => {
        setView(v => {
            const zoom = Math.min(40, Math.max(0.02, v.zoom * factor));
            return { zoom, x: mx - (mx - v.x) * (zoom / v.zoom), y: my - (my - v.y) * (zoom / v.zoom) };
        });
    };

    // Wheel zoom must be a non-passive listener to be able to preventDefault (page scroll).
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left, e.clientY - rect.top);
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", onWheel);
    }, []);

    const zoomBy = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2);

    // ---- pointer events: pan (1 pointer) and pinch (2 pointers) ----
    const local = (e: React.PointerEvent) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const startGesture = (v: View) => {
        const pts = Array.from(pointers.current.values());
        if (pts.length === 1) gesture.current = { view: v, cx: pts[0].x, cy: pts[0].y, dist: 0 };
        else if (pts.length >= 2) {
            const [a, b] = pts;
            gesture.current = { view: v, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
        } else gesture.current = null;
    };
    const onPointerDown = (e: React.PointerEvent) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, local(e));
        startGesture(view);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const p = local(e);
        if (e.pointerType === "mouse") setCursor({ px: (p.x - view.x) / view.zoom, py: (p.y - view.y) / view.zoom });
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, p);
        const g = gesture.current;
        if (!g) return;
        const pts = Array.from(pointers.current.values());
        if (pts.length === 1) {
            setView({ zoom: g.view.zoom, x: g.view.x + (pts[0].x - g.cx), y: g.view.y + (pts[0].y - g.cy) });
        } else if (pts.length >= 2 && g.dist > 0) {
            const [a, b] = pts;
            const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
            const scale = Math.hypot(a.x - b.x, a.y - b.y) / g.dist;
            const zoom = Math.min(40, Math.max(0.02, g.view.zoom * scale));
            const k = zoom / g.view.zoom;
            // keep the point under the initial midpoint fixed, then follow the midpoint drift
            setView({ zoom, x: g.cx - (g.cx - g.view.x) * k + (cx - g.cx), y: g.cy - (g.cy - g.view.y) * k + (cy - g.cy) });
        }
    };
    const onPointerUp = (e: React.PointerEvent) => {
        pointers.current.delete(e.pointerId);
        // re-anchor the remaining pointer so the image doesn't jump
        startGesture(view);
        if (pointers.current.size === 0) gesture.current = null;
    };

    const inside = cursor && cursor.px >= 0 && cursor.py >= 0 && cursor.px < width && cursor.py < height;

    return <div className={"box h-100"}>
        <div ref={containerRef} className={"rows content"} style={{ position: "relative", overflow: "hidden", background: "#000" }}>
            <canvas ref={canvasRef}
                style={{ position: "absolute", left: 0, top: 0, cursor: "grab", touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={(e) => { if (e.pointerType === "mouse") setCursor(null); }}
                onDoubleClick={fit} />
        </div>
        <div className={"rows footer px-2 py-1 small text-muted d-flex align-items-center flex-wrap"} style={{ flex: "0 0 auto", gap: "0 0.75rem" }}>
            <span>
                <button className={"btn btn-sm btn-outline-secondary py-0 me-1"} onClick={() => zoomBy(2)} title={t.zoomIn}>+</button>
                <button className={"btn btn-sm btn-outline-secondary py-0 me-1"} onClick={() => zoomBy(0.5)} title={t.zoomOut}>−</button>
                <button className={"btn btn-sm btn-outline-secondary py-0"} onClick={fit} title={t.fitView}>⤢</button>
            </span>
            <span>{t.zoomLabel(view.zoom.toFixed(2))}</span>
            {inside ? <span className={"d-none d-md-inline"}>
                {t.cursorInfo(Math.floor(cursor.px), Math.floor(cursor.py), ((cursor.px - width / 2) * pixelMm).toFixed(2), ((cursor.py - height / 2) * pixelMm).toFixed(2))}
            </span> : null}
            <span className={"d-none d-lg-inline"}>{t.canvasHelp}</span>
        </div>
    </div>;
}
