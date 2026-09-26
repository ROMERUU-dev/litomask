/**
 * Promise-based client for the litho worker.
 */
import type { WorkerOp, WorkerResults } from "./litho.worker";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (msg: string) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL("./litho.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent) => {
        const m = ev.data;
        const p = pending.get(m.id);
        if (!p) return;
        if (m.progress !== undefined) { p.onProgress?.(m.progress); return; }
        pending.delete(m.id);
        if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => {
        pending.forEach(p => p.reject(new Error(e.message)));
        pending.clear();
    };
    return worker;
}

export function runOp<K extends WorkerOp["op"]>(request: Extract<WorkerOp, { op: K }>, onProgress?: (msg: string) => void): Promise<WorkerResults[K]> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
        getWorker().postMessage({ id, ...request });
    });
}
