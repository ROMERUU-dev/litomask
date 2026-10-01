import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Accordion, Alert, Button, ButtonGroup, Col, Form, Row, ToggleButton } from "react-bootstrap";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { printerModels } from "../formats/printers";
import { countOn, boundingBox } from "../core/bitmap";
import type { Bitmap } from "../core/bitmap";
import { loadImage, rasterizeImage, placeOnScreen, svgWidthMm } from "../core/raster";
import { generateTestPattern, defaultTestPatternOptions } from "../core/testpattern";
import { pulses } from "../core/export";
import type { LithoJob } from "../core/export";
import { runOp } from "../worker/client";
import type { Progress } from "../worker/client";
import PreviewCanvas from "./PreviewCanvas";
import type { PreviewLayer } from "./PreviewCanvas";
import CalibrationFit from "./CalibrationFit";
import { useI18n, translateError } from "../i18n";

type SourceKind = "none" | "image" | "test";
type ViewMode = "design" | "mask" | "split" | "sim" | "aerial";

function num(v: string, fallback = 0): number {
    const n = parseFloat(v);
    return isFinite(n) ? n : fallback;
}

function NumberField(props: { label: string, value: string, onChange: (v: string) => void, step?: number, help?: string, disabled?: boolean }) {
    return <Form.Group as={Row} className={"mb-1 align-items-center g-1"}>
        <Form.Label column xs={7} className={"small py-0"}>{props.label}</Form.Label>
        <Col xs={5}>
            <Form.Control size={"sm"} type={"number"} inputMode={"decimal"} step={props.step ?? "any"} value={props.value}
                disabled={props.disabled} onChange={e => props.onChange(e.target.value)} title={props.help} />
        </Col>
    </Form.Group>;
}

export default function LithoInterface() {
    const { t } = useI18n();
    // ---------------- printer ----------------
    const [printerName, setPrinterName] = useState(Object.keys(printerModels)[0]);
    const printer = printerModels[printerName];
    const [W, H] = printer.resolution;
    const pixelMm = printer.xyRes;
    const pixelUm = pixelMm * 1000;

    // ---------------- source ----------------
    const [sourceKind, setSourceKind] = useState<SourceKind>("none");
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [imageName, setImageName] = useState("mascara");
    const [widthMm, setWidthMm] = useState("20");
    const [brightIsExposed, setBrightIsExposed] = useState(true);
    const [threshold, setThreshold] = useState("128");
    const [offsetXmm, setOffsetXmm] = useState("0");
    const [offsetYmm, setOffsetYmm] = useState("0");
    const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
    const [mirrorX, setMirrorX] = useState(false);
    const [mirrorY, setMirrorY] = useState(false);
    const [invertMask, setInvertMask] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    // test pattern
    const [testCells, setTestCells] = useState("10");
    const [testPitch, setTestPitch] = useState(String(defaultTestPatternOptions.cellPitch));
    const [testTime, setTestTime] = useState("3");

    // ---------------- OPC ----------------
    const [convexSerif, setConvexSerif] = useState("0");
    const [concaveSerif, setConcaveSerif] = useState("0");
    const [biasPx, setBiasPx] = useState("0");
    const [modelOpc, setModelOpc] = useState(false);
    const [modelIters, setModelIters] = useState("4");
    const [modelBand, setModelBand] = useState("3");

    // ---------------- split ----------------
    const [splitDistance, setSplitDistance] = useState("3");
    const [marksEnabled, setMarksEnabled] = useState(true);
    const [markSize, setMarkSize] = useState("60");
    const [markLine, setMarkLine] = useState("4");
    const [markInset, setMarkInset] = useState("80");

    // ---------------- exposure ----------------
    const [expTime, setExpTime] = useState("10");
    const [expPulses, setExpPulses] = useState("1");
    const [expPause, setExpPause] = useState("0");
    const [alignTime, setAlignTime] = useState("300");

    // ---------------- simulation ----------------
    const [sigmaUm, setSigmaUm] = useState("50");
    const [d0s, setD0s] = useState("4");
    const [showFit, setShowFit] = useState(false);

    // ---------------- results ----------------
    const [design, setDesign] = useState<Bitmap | null>(null);
    const [field, setField] = useState<{ x0: number, y0: number, x1: number, y1: number } | null>(null);
    const [testLayers, setTestLayers] = useState<Bitmap[] | null>(null);
    const [mask, setMask] = useState<Bitmap | null>(null);
    const [maskA, setMaskA] = useState<Bitmap | null>(null);
    const [maskB, setMaskB] = useState<Bitmap | null>(null);
    const [marksBoth, setMarksBoth] = useState<Bitmap | null>(null);
    const [splitInfo, setSplitInfo] = useState<string>("");
    const [opcInfo, setOpcInfo] = useState<string>("");
    const [sim, setSim] = useState<Bitmap | null>(null);
    const [aerial, setAerial] = useState<Bitmap | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<ViewMode>("design");
    const [version, setVersion] = useState(0);

    const bump = () => setVersion(v => v + 1);

    const sigmaPx = num(sigmaUm) / pixelUm;
    const dose = num(expTime) * Math.max(1, num(expPulses, 1));
    const simThreshold = dose > 0 ? num(d0s) / dose : 1;

    // ---------------- build design ----------------
    const rebuildDesign = useCallback(() => {
        setError(null);
        try {
            if (sourceKind === "image" && image) {
                const raster = rasterizeImage(image, { widthMm: num(widthMm, 10), pixelMm, brightIsExposed, threshold: num(threshold, 128) });
                const placed = placeOnScreen(raster, W, H, {
                    offsetX: num(offsetXmm) / pixelMm, offsetY: num(offsetYmm) / pixelMm, rotation, mirrorX, mirrorY,
                });
                let d = placed.screen;
                if (invertMask) { for (let i = 0; i < d.data.length; i++) d.data[i] = 255 - d.data[i]; }
                setDesign(d);
                setField(placed.field);
                setTestLayers(null);
            } else if (sourceKind === "test") {
                const opts = { ...defaultTestPatternOptions, cells: Math.max(1, Math.round(num(testCells, 10))), cellPitch: Math.max(200, Math.round(num(testPitch, 380))) };
                const tp = generateTestPattern(W, H, opts);
                if (tp.cells_used < opts.cells) setTestCells(String(tp.cells_used));
                setDesign(tp.all);
                setField(boundingBox(tp.all));
                setTestLayers(tp.doseLayers);
            } else {
                setDesign(null); setField(null); setTestLayers(null);
            }
            setMask(null); setMaskA(null); setMaskB(null); setSim(null); setAerial(null); setMarksBoth(null);
            setView("design");
            bump();
        } catch (e) {
            setError(translateError(e, t));
        }
    }, [sourceKind, image, widthMm, pixelMm, brightIsExposed, threshold, offsetXmm, offsetYmm, rotation, mirrorX, mirrorY, invertMask, W, H, testCells, testPitch]);

    useEffect(() => { rebuildDesign(); }, [rebuildDesign]);

    const onFile = async (f: File) => {
        try {
            const img = await loadImage(f);
            const mm = await svgWidthMm(f);
            if (mm) setWidthMm(mm.toFixed(3));
            setImage(img);
            setImageName(f.name.replace(/\.[^.]+$/, ""));
            setSourceKind("image");
        } catch (e) {
            setError(translateError(e, t));
        }
    };

    // ---------------- processing (in the worker) ----------------
    const run = async <T,>(label: string, fn: (progress: (p: Progress) => void) => Promise<T>, done: (r: T) => void) => {
        setBusy(label);
        setError(null);
        try {
            const r = await fn(p => setBusy(`${label} ${t.progressIter(p.iter, p.residual)}`));
            done(r);
        } catch (e) {
            setError(translateError(e, t));
        } finally {
            setBusy(null);
        }
    };

    const applyOpc = () => {
        if (!design) return;
        run(t.busyOpc, async (progress) => {
            const rule = await runOp({ op: "ruleOpc", design, opts: { convexSerif: num(convexSerif), concaveSerif: num(concaveSerif), bias: Math.round(num(biasPx)) } });
            if (!modelOpc) return { mask: rule.mask, info: "" };
            const r = await runOp({ op: "modelOpc", design: rule.mask, opts: { sigmaPx, threshold: simThreshold, iterations: Math.max(1, Math.round(num(modelIters, 4))), band: Math.max(1, Math.round(num(modelBand, 3))) } }, progress);
            return { mask: r.mask, info: t.modelOpcInfo(r.history.join(" → ")) };
        }, (r) => {
            setMask(r.mask);
            setOpcInfo(r.info);
            setMaskA(null); setMaskB(null); setSim(null); setAerial(null);
            setView("mask");
            bump();
        });
    };

    const applySplit = () => {
        const src = mask ?? design;
        if (!src) return;
        const marks = marksEnabled && field ? {
            field,
            opts: { size: Math.round(num(markSize, 60)), lineWidth: Math.round(num(markLine, 4)), inset: Math.round(num(markInset, 80)), corners: { tl: true, tr: true, bl: true, br: true } },
        } : undefined;
        run(t.busySplit, () => runOp({ op: "split", mask: src, minDistance: num(splitDistance, 3), marks }), (r) => {
            setMaskA(r.a); setMaskB(r.b); setMarksBoth(r.both);
            setSplitInfo(t.splitInfo(r.countA, r.countB) + (r.conflicts ? t.splitConflicts(r.conflicts) : ""));
            setView("split");
            bump();
        });
    };

    const runSim = () => {
        const src = mask ?? design;
        if (!src) return;
        run(t.busySim, () => runOp({ op: "simulate", mask: src, sigmaPx, threshold: simThreshold }), (r) => {
            setSim(r.sim);
            setAerial(r.aerial);
            setView("sim");
            bump();
        });
    };

    // ---------------- export ----------------
    const exportFiles = () => {
        const src = mask ?? design;
        if (!src) return;
        const tExp = num(expTime, 10), n = Math.max(1, Math.round(num(expPulses, 1))), p = Math.max(0, num(expPause));
        const base = sourceKind === "test" ? t.fileCalib : imageName;
        const jobs: LithoJob[] = [];
        if (sourceKind === "test" && testLayers) {
            jobs.push({ name: `${base}_${t.fileDoseMatrix}_${num(testTime, 3)}s_x${testLayers.length}`, layers: testLayers, exposureTime: num(testTime, 3), pause: p });
        } else if (maskA && maskB) {
            jobs.push({ name: `${base}_A`, layers: pulses(maskA, n), exposureTime: tExp, pause: p });
            jobs.push({ name: `${base}_B`, layers: pulses(maskB, n), exposureTime: tExp, pause: p });
            if (marksBoth && countOn(marksBoth) > 0) {
                jobs.push({ name: `${base}_${t.fileAlign}`, layers: [marksBoth], exposureTime: num(alignTime, 300), pause: 0 });
            }
        } else {
            jobs.push({ name: base, layers: pulses(src, n), exposureTime: tExp, pause: p });
        }
        run(t.busyExport, async () => {
            const files: { fileName: string, blob: Blob }[] = [];
            for (const job of jobs) {
                const r = await runOp({ op: "build", job, printerName, printer });
                files.push({ fileName: r.fileName, blob: new Blob([r.bytes]) });
            }
            if (files.length === 1) return { name: files[0].fileName, blob: files[0].blob };
            const zip = new JSZip();
            for (const f of files) zip.file(f.fileName, f.blob);
            return { name: `${base}_litomask.zip`, blob: await zip.generateAsync({ type: "blob" }) };
        }, (r) => saveAs(r.blob, r.name));
    };

    // ---------------- preview layers ----------------
    const previewLayers: PreviewLayer[] = useMemo(() => {
        const L: PreviewLayer[] = [];
        if (view === "design" && design) L.push({ bitmap: design, color: [230, 230, 230] });
        if (view === "mask") {
            if (design) L.push({ bitmap: design, color: [70, 70, 90] });
            if (mask) L.push({ bitmap: mask, color: [160, 200, 255] });
        }
        if (view === "split") {
            if (maskA) L.push({ bitmap: maskA, color: [255, 120, 60] });
            if (maskB) L.push({ bitmap: maskB, color: [60, 160, 255] });
        }
        if (view === "sim") {
            if (design) L.push({ bitmap: design, color: [200, 40, 40] });
            if (sim) L.push({ bitmap: sim, color: [40, 200, 220] });
        }
        if (view === "aerial" && aerial) L.push({ bitmap: aerial, color: [240, 240, 200], grey: true });
        return L;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, version]);

    const totalTime = (num(expTime) + num(expPause)) * Math.max(1, num(expPulses, 1));

    return <div className={"litho-layout"}>
        <div className={"litho-controls dark-bg p-2"}>
            <input type={"file"} ref={fileInput} className={"hidden"} accept={".png,.jpg,.jpeg,.bmp,.gif,.svg,.webp"}
                onInput={() => { const f = fileInput.current?.files?.[0]; if (f) onFile(f); }} />

            <Form.Group className={"mb-2"}>
                <Form.Label className={"small mb-0"}>{t.printer}</Form.Label>
                <Form.Select size={"sm"} value={printerName} onChange={e => setPrinterName(e.target.value)}>
                    {Object.keys(printerModels).map(k => <option key={k} value={k}>{k}</option>)}
                </Form.Select>
                <div className={"small text-muted"}>{t.printerInfo(W, H, pixelUm.toFixed(1), (W * pixelMm).toFixed(1), (H * pixelMm).toFixed(1))}</div>
            </Form.Group>

            <Accordion defaultActiveKey={["0", "4"]} alwaysOpen flush>
                <Accordion.Item eventKey={"0"}>
                    <Accordion.Header>{t.sec1}</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <div className={"mb-2"}>
                            <Button size={"sm"} className={"me-1"} onClick={() => fileInput.current?.click()}>{t.loadImage}</Button>
                            <Button size={"sm"} variant={sourceKind === "test" ? "warning" : "outline-light"} onClick={() => setSourceKind("test")}>{t.testPattern}</Button>
                        </div>
                        {sourceKind === "image" && image ? <>
                            <div className={"small mb-1"}>{t.imageInfo(imageName, image.naturalWidth, image.naturalHeight)}</div>
                            <NumberField label={t.widthMm} value={widthMm} onChange={setWidthMm} />
                            <NumberField label={t.threshold} value={threshold} onChange={setThreshold} step={1} />
                            <Form.Check type={"switch"} className={"small"} label={t.brightIsExposed} checked={brightIsExposed} onChange={e => setBrightIsExposed(e.target.checked)} />
                            <Form.Check type={"switch"} className={"small"} label={t.invert} checked={invertMask} onChange={e => setInvertMask(e.target.checked)} />
                            <NumberField label={t.offsetX} value={offsetXmm} onChange={setOffsetXmm} />
                            <NumberField label={t.offsetY} value={offsetYmm} onChange={setOffsetYmm} />
                            <Row className={"align-items-center mb-1 g-1"}>
                                <Col xs={7} className={"small"}>{t.rotation}</Col>
                                <Col xs={5}>
                                    <ButtonGroup size={"sm"}>
                                        {[0, 90, 180, 270].map(r => <ToggleButton key={r} id={`rot${r}`} type={"radio"} variant={"outline-light"} size={"sm"}
                                            checked={rotation === r} value={r} onChange={() => setRotation(r as 0 | 90 | 180 | 270)}>{r}°</ToggleButton>)}
                                    </ButtonGroup>
                                </Col>
                            </Row>
                            <Form.Check inline type={"switch"} className={"small"} label={t.mirrorX} checked={mirrorX} onChange={e => setMirrorX(e.target.checked)} />
                            <Form.Check inline type={"switch"} className={"small"} label={t.mirrorY} checked={mirrorY} onChange={e => setMirrorY(e.target.checked)} />
                            <div className={"small text-muted mt-1"}>{t.orientationHint}</div>
                        </> : null}
                        {sourceKind === "test" ? <>
                            <NumberField label={t.cells} value={testCells} onChange={setTestCells} step={1} />
                            <NumberField label={t.cellPitch} value={testPitch} onChange={setTestPitch} step={10} />
                            <NumberField label={t.timePerLayer} value={testTime} onChange={setTestTime} />
                            <div className={"small text-muted"}>
                                {t.testInfo(num(testTime, 3), num(testTime, 3) * num(testCells, 10), defaultTestPatternOptions.squareSize, (defaultTestPatternOptions.squareSize * pixelUm).toFixed(0), defaultTestPatternOptions.lineWidths.join(", "), defaultTestPatternOptions.gratingPitches.join(", "))}
                            </div>
                        </> : null}
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"1"}>
                    <Accordion.Header>{t.sec2}</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <NumberField label={t.convexSerif} value={convexSerif} onChange={setConvexSerif} step={1} />
                        <NumberField label={t.concaveSerif} value={concaveSerif} onChange={setConcaveSerif} step={1} />
                        <NumberField label={t.bias} value={biasPx} onChange={setBiasPx} step={1} />
                        <Form.Check type={"switch"} className={"small"} label={t.modelOpc} checked={modelOpc} onChange={e => setModelOpc(e.target.checked)} />
                        {modelOpc ? <>
                            <NumberField label={t.iterations} value={modelIters} onChange={setModelIters} step={1} />
                            <NumberField label={t.band} value={modelBand} onChange={setModelBand} step={1} />
                        </> : null}
                        <Button size={"sm"} className={"mt-1"} disabled={!design || !!busy} onClick={applyOpc}>{t.applyOpc}</Button>
                        {mask ? <span className={"small ms-2"}>{t.maskReady}{opcInfo ? ` · ${opcInfo}` : ""}</span> : null}
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"2"}>
                    <Accordion.Header>{t.sec3}</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <div className={"small text-muted mb-1"}>{t.splitHelp}</div>
                        <NumberField label={t.minDistance} value={splitDistance} onChange={setSplitDistance} step={1} />
                        <Form.Check type={"switch"} className={"small"} label={t.marks} checked={marksEnabled} onChange={e => setMarksEnabled(e.target.checked)} />
                        {marksEnabled ? <>
                            <NumberField label={t.markSize} value={markSize} onChange={setMarkSize} step={2} />
                            <NumberField label={t.markLine} value={markLine} onChange={setMarkLine} step={1} />
                            <NumberField label={t.markInset} value={markInset} onChange={setMarkInset} step={5} />
                            <NumberField label={t.alignTime} value={alignTime} onChange={setAlignTime} />
                        </> : null}
                        <Button size={"sm"} className={"mt-1"} disabled={!design || !!busy} onClick={applySplit}>{t.split}</Button>
                        {maskA ? <span className={"small ms-2"}>{splitInfo}</span> : null}
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"3"}>
                    <Accordion.Header>{t.sec4}</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <NumberField label={t.sigma} value={sigmaUm} onChange={setSigmaUm} />
                        <NumberField label={t.d0} value={d0s} onChange={setD0s} />
                        <div className={"small text-muted mb-1"}>{t.simInfo(sigmaPx.toFixed(2), dose.toFixed(1), simThreshold.toFixed(3))}</div>
                        <Button size={"sm"} className={"me-1"} disabled={!design || !!busy} onClick={runSim}>{t.simulate}</Button>
                        <Button size={"sm"} variant={"outline-light"} onClick={() => setShowFit(true)}>{t.fitButton}</Button>
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"4"}>
                    <Accordion.Header>{t.sec5}</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        {sourceKind === "test" ? <div className={"small text-muted mb-1"}>{t.testExportNote}</div> : null}
                        <NumberField label={t.pulseTime} value={expTime} onChange={setExpTime} disabled={sourceKind === "test"} />
                        <NumberField label={t.pulses} value={expPulses} onChange={setExpPulses} step={1} disabled={sourceKind === "test"} />
                        <NumberField label={t.pause} value={expPause} onChange={setExpPause} />
                        <div className={"small text-muted mb-2"}>
                            {sourceKind === "test" && testLayers ?
                                t.testSummary(testLayers.length, num(testTime, 3)) :
                                t.doseSummary(dose.toFixed(1), Math.max(1, num(expPulses, 1)), totalTime.toFixed(0))}
                            {sourceKind !== "test" && maskA && maskB ? t.zipNote : ""}
                        </div>
                        <Button disabled={!design || !!busy} onClick={exportFiles}>{t.exportBtn(printer.fileFormat)}</Button>
                    </Accordion.Body>
                </Accordion.Item>
            </Accordion>

            {busy ? <Alert variant={"info"} className={"mt-2 py-1 small"}>{busy}</Alert> : null}
            {error ? <Alert variant={"danger"} className={"mt-2 py-1 small"}>{error}</Alert> : null}
        </div>

        <div className={"litho-preview box"}>
            <div className={"rows header p-1 p-md-2 border-bottom d-flex flex-wrap align-items-center"}>
                <ButtonGroup size={"sm"} className={"flex-wrap"}>
                    <ToggleButton id={"v-design"} type={"radio"} variant={"outline-secondary"} checked={view === "design"} value={"design"} onChange={() => setView("design")}>{t.viewDesign}</ToggleButton>
                    <ToggleButton id={"v-mask"} type={"radio"} variant={"outline-secondary"} checked={view === "mask"} value={"mask"} disabled={!mask} onChange={() => setView("mask")}>{t.viewMask}</ToggleButton>
                    <ToggleButton id={"v-split"} type={"radio"} variant={"outline-secondary"} checked={view === "split"} value={"split"} disabled={!maskA} onChange={() => setView("split")}>{t.viewSplit}</ToggleButton>
                    <ToggleButton id={"v-sim"} type={"radio"} variant={"outline-secondary"} checked={view === "sim"} value={"sim"} disabled={!sim} onChange={() => setView("sim")}>{t.viewSim}</ToggleButton>
                    <ToggleButton id={"v-aerial"} type={"radio"} variant={"outline-secondary"} checked={view === "aerial"} value={"aerial"} disabled={!aerial} onChange={() => setView("aerial")}>{t.viewAerial}</ToggleButton>
                </ButtonGroup>
                <span className={"small text-muted ms-2 ms-md-3"}>
                    {view === "sim" ? t.legendSim : null}
                    {view === "split" ? t.legendSplit : null}
                    {view === "mask" ? t.legendMask : null}
                </span>
            </div>
            <div className={"rows content"}>
                {design ?
                    <PreviewCanvas layers={previewLayers} width={W} height={H} pixelMm={pixelMm} version={version + (view === "design" ? 0 : 1000)} />
                    : <div className={"d-flex h-100 align-items-center justify-content-center text-muted"}>{t.emptyHint}</div>}
            </div>
        </div>

        <CalibrationFit show={showFit} onHide={() => setShowFit(false)}
            timePerLayer={num(testTime, 3)} cells={Math.max(1, Math.round(num(testCells, 10)))}
            nominalWidthUm={defaultTestPatternOptions.squareSize * pixelUm} pixelUm={pixelUm}
            onApply={(s, d0) => { setSigmaUm(s.toFixed(1)); setD0s(d0.toFixed(2)); }} />
    </div>;
}
