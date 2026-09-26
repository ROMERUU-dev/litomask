/**
 * Web Worker that runs the heavy bitmap operations off the UI thread.
 * Messages: { id, op, payload } -> { id, ok, result } | { id, ok: false, error } | { id, progress }
 */
import type { Bitmap } from "../core/bitmap";
import { or } from "../core/bitmap";
import { applyRuleOpc, applyModelOpc } from "../core/opc";
import type { RuleOpcOptions, ModelOpcOptions } from "../core/opc";
import { splitMask, alignmentMarks } from "../core/split";
import type { AlignmentMarkOptions } from "../core/split";
import { simulateExposure, aerialImage } from "../core/simulate";
import { buildLithoFile } from "../core/export";
import type { LithoJob } from "../core/export";
import type { PrinterModel } from "../formats/printers";

export type WorkerOp =
    | { op: "ruleOpc"; design: Bitmap; opts: RuleOpcOptions }
    | { op: "modelOpc"; design: Bitmap; opts: ModelOpcOptions }
    | { op: "split"; mask: Bitmap; minDistance: number; marks?: { field: { x0: number, y0: number, x1: number, y1: number }, opts: AlignmentMarkOptions } }
    | { op: "simulate"; mask: Bitmap; sigmaPx: number; threshold: number }
    | { op: "build"; job: LithoJob; printerName: string; printer: PrinterModel };

export interface WorkerResults {
    ruleOpc: { mask: Bitmap };
    modelOpc: { mask: Bitmap; history: number[]; residual: number };
    split: { a: Bitmap; b: Bitmap; both: Bitmap | null; countA: number; countB: number; conflicts: number };
    simulate: { sim: Bitmap; aerial: Bitmap };
    build: { fileName: string; bytes: ArrayBuffer; layerCount: number; totalTimeS: number };
}

type Request = { id: number } & WorkerOp;

const ctx = self as unknown as Worker;

function transferOf(...bitmaps: (Bitmap | null | undefined)[]): ArrayBuffer[] {
    return bitmaps.filter((b): b is Bitmap => !!b).map(b => b.data.buffer as ArrayBuffer);
}

ctx.onmessage = async (ev: MessageEvent<Request>) => {
    const msg = ev.data;
    try {
        switch (msg.op) {
            case "ruleOpc": {
                const mask = applyRuleOpc(msg.design, msg.opts);
                ctx.postMessage({ id: msg.id, ok: true, result: { mask } }, transferOf(mask));
                break;
            }
            case "modelOpc": {
                const r = applyModelOpc(msg.design, msg.opts, (iter, residual) => {
                    ctx.postMessage({ id: msg.id, progress: `iteración ${iter + 1}: residuo ${residual} px` });
                });
                ctx.postMessage({ id: msg.id, ok: true, result: { mask: r.mask, history: r.history, residual: r.residual } }, transferOf(r.mask));
                break;
            }
            case "split": {
                const r = splitMask(msg.mask, msg.minDistance);
                let a = r.a, b = r.b, both: Bitmap | null = null;
                if (msg.marks) {
                    const m = alignmentMarks(msg.mask.width, msg.mask.height, msg.marks.field, msg.marks.opts);
                    a = or(a, m.a); b = or(b, m.b); both = m.both;
                }
                ctx.postMessage({ id: msg.id, ok: true, result: { a, b, both, countA: r.countA, countB: r.countB, conflicts: r.conflicts } }, transferOf(a, b, both));
                break;
            }
            case "simulate": {
                const sim = simulateExposure(msg.mask, msg.sigmaPx, msg.threshold);
                const aerial = aerialImage(msg.mask, msg.sigmaPx);
                ctx.postMessage({ id: msg.id, ok: true, result: { sim, aerial } }, transferOf(sim, aerial));
                break;
            }
            case "build": {
                const f = buildLithoFile(msg.job, msg.printerName, msg.printer);
                const bytes = await f.blob.arrayBuffer();
                ctx.postMessage({ id: msg.id, ok: true, result: { fileName: f.fileName, bytes, layerCount: f.layerCount, totalTimeS: f.totalTimeS } }, [bytes]);
                break;
            }
        }
    } catch (e) {
        ctx.postMessage({ id: msg.id, ok: false, error: String((e as Error)?.message ?? e) });
    }
};
