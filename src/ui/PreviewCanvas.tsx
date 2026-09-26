import React, { useEffect, useMemo, useRef, useState } from "react";
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

/** Full-resolution composite drawn to an offscreen canvas, then shown with zoom/pan. */
export default function PreviewCanvas(props: Props) {
    const { layers, width, height, pixelMm, version } = props;
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [view, setView] = useState({ zoom: 0.2, x: 0, y: 0 });
    const [cursor, setCursor] = useState<{ px: number, py: number } | null>(null);
    const dragRef = useRef<{ sx: number, sy: number, ox: number, oy: number } | null>(null);
    const fittedRef = useRef(false);

    const offscreen = useMemo(() => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d")!;
        const img = ctx.createImageData(width, height);
        const d = img.data;
        const n = width * height;
        for (let i = 0; i < n; i++) { d[i * 4] = 16; d[i * 4 + 1] = 16; d[i * 4 + 2] = 20; d[i * 4 + 3] = 255; }
        for (const layer of layers) {
            if (!layer.bitmap || layer.bitmap.width !== width || layer.bitmap.height !== height) continue;
            const src = layer.bitmap.data;
            const [r, g, b] = layer.color;
            if (layer.grey) {
                for (let i = 0; i < n; i++) {
                    const v = src[i] / 255;
                    if (v <= 0) continue;
                    d[i * 4] = Math.min(255, d[i * 4] + r * v);
                    d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] + g * v);
                    d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] + b * v);
                }
            } else {
                for (let i = 0; i < n; i++) {
                    if (src[i] < 128) continue;
                    d[i * 4] = Math.min(255, d[i * 4] + r);
                    d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] + g);
                    d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] + b);
                }
            }
        }
        ctx.putImageData(img, 0, 0);
        return c;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, width, height]);

    const fit = () => {
        const el = containerRef.current;
        if (!el) return;
        const zoom = Math.min(el.clientWidth / width, el.clientHeight / height) * 0.97;
        setView({ zoom, x: (el.clientWidth - width * zoom) / 2, y: (el.clientHeight - height * zoom) / 2 });
    };

    useEffect(() => {
        if (!fittedRef.current) { fit(); fittedRef.current = true; }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, height]);

    useEffect(() => {
        const canvas = canvasRef.current, el = containerRef.current;
        if (!canvas || !el) return;
        canvas.width = el.clientWidth;
        canvas.height = el.clientHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = view.zoom < 1;
        ctx.setTransform(view.zoom, 0, 0, view.zoom, view.x, view.y);
        ctx.drawImage(offscreen, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // screen border
        ctx.strokeStyle = "#888";
        ctx.strokeRect(view.x, view.y, width * view.zoom, height * view.zoom);
        // scale bar (1 mm or 10 mm)
        const mmPerPx = pixelMm;
        const barMm = view.zoom * (10 / mmPerPx) > 60 ? (view.zoom * (1 / mmPerPx) > 60 ? 1 : 10) : 10;
        const barPx = barMm / mmPerPx * view.zoom;
        ctx.fillStyle = "#fff";
        ctx.fillRect(12, canvas.height - 18, barPx, 3);
        ctx.font = "12px sans-serif";
        ctx.fillText(`${barMm} mm`, 12, canvas.height - 24);
    }, [view, offscreen, width, height, pixelMm]);

    // Wheel zoom must be a non-passive listener to be able to preventDefault (page scroll).
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
            setView(v => {
                const zoom = Math.min(40, Math.max(0.02, v.zoom * factor));
                return { zoom, x: mx - (mx - v.x) * (zoom / v.zoom), y: my - (my - v.y) * (zoom / v.zoom) };
            });
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", onWheel);
    }, []);

    const zoomBy = (factor: number) => {
        const el = containerRef.current;
        if (!el) return;
        const mx = el.clientWidth / 2, my = el.clientHeight / 2;
        setView(v => {
            const zoom = Math.min(40, Math.max(0.02, v.zoom * factor));
            return { zoom, x: mx - (mx - v.x) * (zoom / v.zoom), y: my - (my - v.y) * (zoom / v.zoom) };
        });
    };

    const onMouseDown = (e: React.MouseEvent) => {
        dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    };
    const onMouseMove = (e: React.MouseEvent) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        setCursor({ px: (mx - view.x) / view.zoom, py: (my - view.y) / view.zoom });
        if (dragRef.current) {
            const d = dragRef.current;
            setView(v => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
        }
    };
    const onMouseUp = () => { dragRef.current = null; };

    return <div className={"box h-100"}>
        <div ref={containerRef} className={"rows content"} style={{ position: "relative", overflow: "hidden", background: "#000" }}>
            <canvas ref={canvasRef}
                style={{ position: "absolute", left: 0, top: 0, cursor: "grab" }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onDoubleClick={fit} />
        </div>
        <div className={"rows footer px-2 py-1 small text-muted d-flex align-items-center"} style={{ flex: "0 0 auto" }}>
            <button className={"btn btn-sm btn-outline-secondary py-0 me-1"} onClick={() => zoomBy(2)} title={t.zoomIn}>+</button>
            <button className={"btn btn-sm btn-outline-secondary py-0 me-1"} onClick={() => zoomBy(0.5)} title={t.zoomOut}>−</button>
            <button className={"btn btn-sm btn-outline-secondary py-0 me-2"} onClick={fit} title={t.fitView}>⤢</button>
            {t.zoomLabel(view.zoom.toFixed(2))}
            {cursor && cursor.px >= 0 && cursor.py >= 0 && cursor.px < width && cursor.py < height ?
                <span className={"ms-3"}>
                    {t.cursorInfo(Math.floor(cursor.px), Math.floor(cursor.py), ((cursor.px - width / 2) * pixelMm).toFixed(2), ((cursor.py - height / 2) * pixelMm).toFixed(2))}
                </span> : null}
            <span className={"ms-3"}>{t.canvasHelp}</span>
        </div>
    </div>;
}
