import { useEffect, useState } from "react";
import { Alert, Button, Form } from "react-bootstrap";
import {
    BridgeClient, BridgeError, BRIDGE_STORAGE_KEY, DEFAULT_BRIDGE_URL,
    formatBytes, isMixedContent, normalizeBridgeUrl, shouldProbeOrigin, toBridgeFileName,
} from "../core/printerLink";
import type { BridgeStatus, OutputFile } from "../core/printerLink";
import { useI18n, translateError } from "../i18n";
import type { Strings } from "../i18n/es";

interface Props {
    /** Hay un diseño cargado (sin él no hay nada que enviar). */
    hasDesign: boolean;
    /** Estado ocupado global de la app; mientras exista, los botones se deshabilitan. */
    busy: string | null;
    setBusy: (b: string | null) => void;
    setError: (e: string | null) => void;
    /** Construye los archivos de impresora (misma lógica que la descarga, sin ZIP). */
    buildFiles: () => Promise<OutputFile[]>;
}

interface SentFile { name: string; size: number }

function describeError(e: unknown, t: Strings, url: string): string {
    if (e instanceof BridgeError) {
        switch (e.code) {
            case "network":
            case "timeout": return t.errBridgeUnreachable(url);
            case "not_bridge": return t.errBridgeNotBridge(url);
            case "busy": return t.errBridgeBusy;
            case "no_space": return t.errBridgeNoSpace;
            case "not_found": return t.errBridgeNotFound(e.fileName || e.detail);
            case "bad_name": return t.errBridgeBadName(e.fileName || e.detail);
            default: return t.errBridgeHttp(e.status, e.detail);
        }
    }
    return translateError(e, t);
}

function readStoredUrl(): string {
    try { return localStorage.getItem(BRIDGE_STORAGE_KEY) ?? ""; } catch { return ""; }
}

/**
 * Sección "Enviar a la impresora": sube los archivos generados al puente USB (Raspberry Pi
 * que emula una memoria USB enchufada a la impresora) y gestiona la memoria.
 */
export default function PrinterLink({ hasDesign, busy, setBusy, setError, buildFiles }: Props) {
    const { t } = useI18n();
    const [bridgeUrl, setBridgeUrl] = useState<string>(readStoredUrl);
    const [status, setStatus] = useState<BridgeStatus | null>(null);
    const [sent, setSent] = useState<SentFile[] | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const effectiveUrl = normalizeBridgeUrl(bridgeUrl) || DEFAULT_BRIDGE_URL;
    const mixed = typeof window !== "undefined" && isMixedContent(window.location.protocol, effectiveUrl);
    const disabled = !!busy || mixed;

    // Al montar: si no hay dirección guardada y la app no viene de GitHub Pages ni del servidor
    // de desarrollo, probamos el propio origen (la app servida desde la Pi).
    useEffect(() => {
        if (readStoredUrl() || typeof window === "undefined" || !shouldProbeOrigin(window.location)) return;
        let cancelled = false;
        const origin = window.location.origin;
        new BridgeClient(origin, { timeoutMs: 3000 }).status()
            .then(s => { if (!cancelled) { setBridgeUrl(origin); setStatus(s); } })
            .catch(() => { /* este origen no es un puente */ });
        return () => { cancelled = true; };
    }, []);

    const onUrlChange = (v: string) => {
        setBridgeUrl(v);
        setStatus(null);
        try {
            if (v.trim()) localStorage.setItem(BRIDGE_STORAGE_KEY, v.trim());
            else localStorage.removeItem(BRIDGE_STORAGE_KEY);
        } catch { /* almacenamiento no disponible */ }
    };

    const client = () => new BridgeClient(effectiveUrl);

    const withBusy = async (label: string, fn: () => Promise<void>) => {
        setBusy(label);
        setError(null);
        try {
            await fn();
        } catch (e) {
            setError(describeError(e, t, effectiveUrl));
        } finally {
            setBusy(null);
        }
    };

    const refresh = async (c: BridgeClient) => setStatus(await c.status());

    const testConnection = () => withBusy(t.busyBridgeTest, async () => {
        setNotice(null);
        await refresh(client());
    });

    const reconnect = () => withBusy(t.busyBridgeReconnect, async () => {
        setNotice(null);
        const c = client();
        await c.reconnect();
        setNotice(t.bridgeReconnected);
        await refresh(c);
    });

    const removeFile = (name: string) => {
        if (!window.confirm(t.bridgeDeleteConfirm(name))) return;
        withBusy(t.busyBridgeDelete(name), async () => {
            const c = client();
            await c.remove(name);
            await refresh(c);
        });
    };

    const send = () => withBusy(t.busyExport, async () => {
        setSent(null);
        setNotice(null);
        const c = client();
        const built = await buildFiles();
        if (!built.length) return;
        const files: { name: string; bytes: ArrayBuffer }[] = [];
        for (const f of built) {
            const name = toBridgeFileName(f.fileName);
            if (!name) throw new BridgeError("bad_name", 0, "", f.fileName);
            files.push({ name, bytes: f.bytes });
        }
        const done: SentFile[] = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const show = (pct: number) => setBusy(t.busyBridgeUpload(i + 1, files.length, f.name, pct));
            show(0);
            const r = await c.upload(f.name, f.bytes, (s, total) => show(total > 0 ? Math.min(100, Math.round(100 * s / total)) : 0));
            done.push(r);
            setSent([...done]);
        }
        setBusy(t.busyBridgeReconnect);
        await c.reconnect();
        setNotice(t.bridgeDone(done.length));
        await refresh(c);
    });

    return <>
        <div className={"small text-muted mb-2"}>{t.bridgeHelp}</div>
        <Form.Group className={"mb-2"}>
            <Form.Label className={"small mb-0"}>{t.bridgeUrl}</Form.Label>
            <Form.Control size={"sm"} type={"text"} inputMode={"url"} spellCheck={false} autoComplete={"off"}
                placeholder={DEFAULT_BRIDGE_URL} value={bridgeUrl} onChange={e => onUrlChange(e.target.value)} />
            <div className={"small text-muted"}>{t.bridgeUrlHint}</div>
        </Form.Group>

        {mixed ? <Alert variant={"warning"} className={"py-1 small"}>{t.bridgeMixedContent(effectiveUrl)}</Alert> : null}

        <div className={"mb-2"}>
            <Button size={"sm"} variant={"outline-light"} className={"me-1 mb-1"} disabled={disabled} onClick={testConnection}>{t.bridgeTest}</Button>
            <Button size={"sm"} variant={"outline-light"} className={"mb-1"} disabled={disabled} onClick={reconnect}>{t.bridgeReconnect}</Button>
        </div>

        {status ? <div className={"small mb-2"}>
            <div>{t.bridgeStatusLine(status.mode === "gadget" ? t.bridgeModeGadget : t.bridgeModeDev, status.label,
                status.exported ? t.bridgeExported : t.bridgeNotExported, status.version)}</div>
            <div>{t.bridgeSpace(formatBytes(status.free_bytes), formatBytes(status.total_bytes))}</div>
            <div className={"mt-1"}>{t.bridgeFiles}</div>
            {status.files.length ? status.files.map(f =>
                <div key={f.name} className={"d-flex align-items-center gap-2 border-top border-secondary py-1"}>
                    <span className={"text-break flex-grow-1"}>{f.name}</span>
                    <span className={"text-nowrap text-muted"}>{formatBytes(f.size)}</span>
                    <Button size={"sm"} variant={"outline-danger"} className={"py-0"} disabled={disabled} onClick={() => removeFile(f.name)}>{t.bridgeDelete}</Button>
                </div>)
                : <div className={"text-muted"}>{t.bridgeNoFiles}</div>}
        </div> : null}

        {notice ? <Alert variant={"success"} className={"py-1 small"}>{notice}</Alert> : null}

        <Button disabled={!hasDesign || disabled} onClick={send}>{t.bridgeSend}</Button>

        {sent && sent.length ? <div className={"small mt-2"}>
            <div>{t.bridgeSentList}</div>
            <ul className={"mb-1 ps-3"}>{sent.map(s => <li key={s.name}>{s.name} · {formatBytes(s.size)}</li>)}</ul>
            <div className={"text-muted"}>{t.bridgeSentHint}</div>
        </div> : null}
    </>;
}
