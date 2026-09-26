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
import PreviewCanvas from "./PreviewCanvas";
import type { PreviewLayer } from "./PreviewCanvas";
import CalibrationFit from "./CalibrationFit";

type SourceKind = "none" | "image" | "test";
type ViewMode = "design" | "mask" | "split" | "sim" | "aerial";

function num(v: string, fallback = 0): number {
    const n = parseFloat(v);
    return isFinite(n) ? n : fallback;
}

function NumberField(props: { label: string, value: string, onChange: (v: string) => void, step?: number, help?: string, disabled?: boolean }) {
    return <Form.Group as={Row} className={"mb-1 align-items-center"}>
        <Form.Label column sm={7} className={"small py-0"}>{props.label}</Form.Label>
        <Col sm={5}>
            <Form.Control size={"sm"} type={"number"} step={props.step ?? "any"} value={props.value}
                disabled={props.disabled} onChange={e => props.onChange(e.target.value)} title={props.help} />
        </Col>
    </Form.Group>;
}

export default function LithoInterface() {
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
            setError(String((e as Error)?.message ?? e));
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
            setError(String((e as Error)?.message ?? e));
        }
    };

    // ---------------- processing (in the worker) ----------------
    const run = async <T,>(label: string, fn: (progress: (m: string) => void) => Promise<T>, done: (r: T) => void) => {
        setBusy(label);
        setError(null);
        try {
            const r = await fn(m => setBusy(`${label} ${m}`));
            done(r);
        } catch (e) {
            setError(String((e as Error)?.message ?? e));
        } finally {
            setBusy(null);
        }
    };

    const applyOpc = () => {
        if (!design) return;
        run("Aplicando corrección...", async (progress) => {
            const rule = await runOp({ op: "ruleOpc", design, opts: { convexSerif: num(convexSerif), concaveSerif: num(concaveSerif), bias: Math.round(num(biasPx)) } });
            if (!modelOpc) return { mask: rule.mask, info: "" };
            const r = await runOp({ op: "modelOpc", design: rule.mask, opts: { sigmaPx, threshold: simThreshold, iterations: Math.max(1, Math.round(num(modelIters, 4))), band: Math.max(1, Math.round(num(modelBand, 3))) } }, progress);
            return { mask: r.mask, info: `OPC por modelo: residuo ${r.history.join(" → ")} px` };
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
        run("Dividiendo máscara...", () => runOp({ op: "split", mask: src, minDistance: num(splitDistance, 3), marks }), (r) => {
            setMaskA(r.a); setMaskB(r.b); setMarksBoth(r.both);
            setSplitInfo(`Máscara A: ${r.countA} figuras · Máscara B: ${r.countB} figuras` + (r.conflicts ? ` · ${r.conflicts} conflictos sin resolver (quedan en A)` : ""));
            setView("split");
            bump();
        });
    };

    const runSim = () => {
        const src = mask ?? design;
        if (!src) return;
        run("Simulando exposición...", () => runOp({ op: "simulate", mask: src, sigmaPx, threshold: simThreshold }), (r) => {
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
        const t = num(expTime, 10), n = Math.max(1, Math.round(num(expPulses, 1))), p = Math.max(0, num(expPause));
        const base = sourceKind === "test" ? "calibracion" : imageName;
        const jobs: LithoJob[] = [];
        if (sourceKind === "test" && testLayers) {
            jobs.push({ name: `${base}_matriz_dosis_${num(testTime, 3)}s_x${testLayers.length}`, layers: testLayers, exposureTime: num(testTime, 3), pause: p });
        } else if (maskA && maskB) {
            jobs.push({ name: `${base}_A`, layers: pulses(maskA, n), exposureTime: t, pause: p });
            jobs.push({ name: `${base}_B`, layers: pulses(maskB, n), exposureTime: t, pause: p });
            if (marksBoth && countOn(marksBoth) > 0) {
                jobs.push({ name: `${base}_alineacion`, layers: [marksBoth], exposureTime: num(alignTime, 300), pause: 0 });
            }
        } else {
            jobs.push({ name: base, layers: pulses(src, n), exposureTime: t, pause: p });
        }
        run("Generando archivos...", async () => {
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

    return <div className={"row h-100 g-0"}>
        <div className={"col-4 dark-bg p-2 h-100"} style={{ overflowY: "auto" }}>
            <input type={"file"} ref={fileInput} className={"hidden"} accept={".png,.jpg,.jpeg,.bmp,.gif,.svg,.webp"}
                onInput={() => { const f = fileInput.current?.files?.[0]; if (f) onFile(f); }} />

            <Form.Group className={"mb-2"}>
                <Form.Label className={"small mb-0"}>Impresora</Form.Label>
                <Form.Select size={"sm"} value={printerName} onChange={e => setPrinterName(e.target.value)}>
                    {Object.keys(printerModels).map(k => <option key={k} value={k}>{k}</option>)}
                </Form.Select>
                <div className={"small text-muted"}>{W} × {H} px · {pixelUm.toFixed(1)} µm/px · {(W * pixelMm).toFixed(1)} × {(H * pixelMm).toFixed(1)} mm</div>
            </Form.Group>

            <Accordion defaultActiveKey={["0", "4"]} alwaysOpen flush>
                <Accordion.Item eventKey={"0"}>
                    <Accordion.Header>1 · Máscara</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <div className={"mb-2"}>
                            <Button size={"sm"} className={"me-1"} onClick={() => fileInput.current?.click()}>Cargar PNG / SVG</Button>
                            <Button size={"sm"} variant={sourceKind === "test" ? "warning" : "outline-light"} onClick={() => setSourceKind("test")}>Patrón de calibración</Button>
                        </div>
                        {sourceKind === "image" && image ? <>
                            <div className={"small mb-1"}>{imageName} · {image.naturalWidth} × {image.naturalHeight} px de imagen</div>
                            <NumberField label={"Ancho físico (mm)"} value={widthMm} onChange={setWidthMm} />
                            <NumberField label={"Umbral de luminancia (0-255)"} value={threshold} onChange={setThreshold} step={1} />
                            <Form.Check type={"switch"} className={"small"} label={"Los píxeles claros son los expuestos"} checked={brightIsExposed} onChange={e => setBrightIsExposed(e.target.checked)} />
                            <Form.Check type={"switch"} className={"small"} label={"Invertir (tono negativo)"} checked={invertMask} onChange={e => setInvertMask(e.target.checked)} />
                            <NumberField label={"Desplazamiento X (mm)"} value={offsetXmm} onChange={setOffsetXmm} />
                            <NumberField label={"Desplazamiento Y (mm)"} value={offsetYmm} onChange={setOffsetYmm} />
                            <Row className={"align-items-center mb-1"}>
                                <Col sm={7} className={"small"}>Rotación</Col>
                                <Col sm={5}>
                                    <ButtonGroup size={"sm"}>
                                        {[0, 90, 180, 270].map(r => <ToggleButton key={r} id={`rot${r}`} type={"radio"} variant={"outline-light"} size={"sm"}
                                            checked={rotation === r} value={r} onChange={() => setRotation(r as 0 | 90 | 180 | 270)}>{r}°</ToggleButton>)}
                                    </ButtonGroup>
                                </Col>
                            </Row>
                            <Form.Check inline type={"switch"} className={"small"} label={"Espejo X"} checked={mirrorX} onChange={e => setMirrorX(e.target.checked)} />
                            <Form.Check inline type={"switch"} className={"small"} label={"Espejo Y"} checked={mirrorY} onChange={e => setMirrorY(e.target.checked)} />
                            <div className={"small text-muted mt-1"}>
                                La imagen tal como se ve aquí es lo que verás sobre la resina mirándola de frente (el sustrato va boca abajo sobre la pantalla).
                                Confírmalo con la "F" del patrón de calibración.
                            </div>
                        </> : null}
                        {sourceKind === "test" ? <>
                            <NumberField label={"Celdas (pasos de dosis)"} value={testCells} onChange={setTestCells} step={1} />
                            <NumberField label={"Paso entre celdas (px)"} value={testPitch} onChange={setTestPitch} step={10} />
                            <NumberField label={"Tiempo por capa t (s)"} value={testTime} onChange={setTestTime} />
                            <div className={"small text-muted"}>
                                La celda k recibe k × t = {num(testTime, 3)} … {num(testTime, 3) * num(testCells, 10)} s.
                                Cuadro grande: {defaultTestPatternOptions.squareSize} px = {(defaultTestPatternOptions.squareSize * pixelUm).toFixed(0)} µm.
                                Líneas de {defaultTestPatternOptions.lineWidths.join(", ")} px; rejillas de paso {defaultTestPatternOptions.gratingPitches.join(", ")} px.
                            </div>
                        </> : null}
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"1"}>
                    <Accordion.Header>2 · Corrección de proximidad (OPC)</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <NumberField label={"Serif en esquinas convexas (px)"} value={convexSerif} onChange={setConvexSerif} step={1} />
                        <NumberField label={"Anti-serif en esquinas cóncavas (px)"} value={concaveSerif} onChange={setConcaveSerif} step={1} />
                        <NumberField label={"Sesgo global (px, + ensancha)"} value={biasPx} onChange={setBiasPx} step={1} />
                        <Form.Check type={"switch"} className={"small"} label={"OPC por modelo (usa σ y D₀ de la simulación)"} checked={modelOpc} onChange={e => setModelOpc(e.target.checked)} />
                        {modelOpc ? <>
                            <NumberField label={"Iteraciones"} value={modelIters} onChange={setModelIters} step={1} />
                            <NumberField label={"Banda de corrección (px)"} value={modelBand} onChange={setModelBand} step={1} />
                        </> : null}
                        <Button size={"sm"} className={"mt-1"} disabled={!design || !!busy} onClick={applyOpc}>Aplicar corrección</Button>
                        {mask ? <span className={"small ms-2"}>máscara corregida lista{opcInfo ? ` · ${opcInfo}` : ""}</span> : null}
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"2"}>
                    <Accordion.Header>3 · Doble patronado (A / B)</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <div className={"small text-muted mb-1"}>
                            Separa en dos máscaras las figuras más cercanas que la distancia indicada. Solo sirve si entre A y B
                            revelas, grabas o endureces y vuelves a recubrir; en una sola capa de resina la dosis se suma igual.
                        </div>
                        <NumberField label={"Distancia mínima entre figuras (px)"} value={splitDistance} onChange={setSplitDistance} step={1} />
                        <Form.Check type={"switch"} className={"small"} label={"Marcas de alineación (cruz en A, caja en B)"} checked={marksEnabled} onChange={e => setMarksEnabled(e.target.checked)} />
                        {marksEnabled ? <>
                            <NumberField label={"Tamaño de la cruz (px)"} value={markSize} onChange={setMarkSize} step={2} />
                            <NumberField label={"Grosor de línea (px)"} value={markLine} onChange={setMarkLine} step={1} />
                            <NumberField label={"Separación del campo (px)"} value={markInset} onChange={setMarkInset} step={5} />
                            <NumberField label={"Tiempo del archivo de alineación (s)"} value={alignTime} onChange={setAlignTime} />
                        </> : null}
                        <Button size={"sm"} className={"mt-1"} disabled={!design || !!busy} onClick={applySplit}>Dividir</Button>
                        {maskA ? <span className={"small ms-2"}>{splitInfo}</span> : null}
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"3"}>
                    <Accordion.Header>4 · Simulación y calibración</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        <NumberField label={"Desenfoque σ (µm)"} value={sigmaUm} onChange={setSigmaUm} />
                        <NumberField label={"Dosis mínima D₀ (s)"} value={d0s} onChange={setD0s} />
                        <div className={"small text-muted mb-1"}>
                            σ = {sigmaPx.toFixed(2)} px · dosis actual {dose.toFixed(1)} s · umbral D₀/D = {simThreshold.toFixed(3)}
                        </div>
                        <Button size={"sm"} className={"me-1"} disabled={!design || !!busy} onClick={runSim}>Simular</Button>
                        <Button size={"sm"} variant={"outline-light"} onClick={() => setShowFit(true)}>Ajustar σ y D₀ con mediciones</Button>
                    </Accordion.Body>
                </Accordion.Item>

                <Accordion.Item eventKey={"4"}>
                    <Accordion.Header>5 · Exposición y exportar</Accordion.Header>
                    <Accordion.Body className={"p-2"}>
                        {sourceKind === "test" ? <div className={"small text-muted mb-1"}>La matriz de dosis usa el tiempo por capa del patrón; aquí solo aplica la pausa.</div> : null}
                        <NumberField label={"Tiempo por pulso (s)"} value={expTime} onChange={setExpTime} disabled={sourceKind === "test"} />
                        <NumberField label={"Número de pulsos"} value={expPulses} onChange={setExpPulses} step={1} disabled={sourceKind === "test"} />
                        <NumberField label={"Pausa entre pulsos (s)"} value={expPause} onChange={setExpPause} />
                        <div className={"small text-muted mb-2"}>
                            {sourceKind === "test" && testLayers ?
                                `${testLayers.length} capas × ${num(testTime, 3)} s` :
                                `Dosis total ${dose.toFixed(1)} s en ${Math.max(1, num(expPulses, 1))} pulso(s) · duración ≈ ${totalTime.toFixed(0)} s`}
                            {maskA && maskB ? " · se exportan A, B y alineación en un ZIP" : ""}
                        </div>
                        <Button disabled={!design || !!busy} onClick={exportFiles}>Exportar .{printer.fileFormat}</Button>
                    </Accordion.Body>
                </Accordion.Item>
            </Accordion>

            {busy ? <Alert variant={"info"} className={"mt-2 py-1 small"}>{busy}</Alert> : null}
            {error ? <Alert variant={"danger"} className={"mt-2 py-1 small"}>{error}</Alert> : null}
        </div>

        <div className={"col-8 h-100 box"}>
            <div className={"rows header p-2 border-bottom"}>
                <ButtonGroup size={"sm"}>
                    <ToggleButton id={"v-design"} type={"radio"} variant={"outline-secondary"} checked={view === "design"} value={"design"} onChange={() => setView("design")}>Diseño</ToggleButton>
                    <ToggleButton id={"v-mask"} type={"radio"} variant={"outline-secondary"} checked={view === "mask"} value={"mask"} disabled={!mask} onChange={() => setView("mask")}>Máscara corregida</ToggleButton>
                    <ToggleButton id={"v-split"} type={"radio"} variant={"outline-secondary"} checked={view === "split"} value={"split"} disabled={!maskA} onChange={() => setView("split")}>A / B</ToggleButton>
                    <ToggleButton id={"v-sim"} type={"radio"} variant={"outline-secondary"} checked={view === "sim"} value={"sim"} disabled={!sim} onChange={() => setView("sim")}>Simulación</ToggleButton>
                    <ToggleButton id={"v-aerial"} type={"radio"} variant={"outline-secondary"} checked={view === "aerial"} value={"aerial"} disabled={!aerial} onChange={() => setView("aerial")}>Imagen aérea</ToggleButton>
                </ButtonGroup>
                <span className={"small text-muted ms-3"}>
                    {view === "sim" ? "rojo = diseño sin exponer, cian = expuesto de más, blanco = coincide" : null}
                    {view === "split" ? "naranja = máscara A, azul = máscara B" : null}
                    {view === "mask" ? "gris = diseño, azul claro = máscara con corrección" : null}
                </span>
            </div>
            <div className={"rows content"}>
                {design ?
                    <PreviewCanvas layers={previewLayers} width={W} height={H} pixelMm={pixelMm} version={version + (view === "design" ? 0 : 1000)} />
                    : <div className={"d-flex h-100 align-items-center justify-content-center text-muted"}>Carga una máscara o genera el patrón de calibración</div>}
            </div>
        </div>

        <CalibrationFit show={showFit} onHide={() => setShowFit(false)}
            timePerLayer={num(testTime, 3)} cells={Math.max(1, Math.round(num(testCells, 10)))}
            nominalWidthUm={defaultTestPatternOptions.squareSize * pixelUm} pixelUm={pixelUm}
            onApply={(s, d0) => { setSigmaUm(s.toFixed(1)); setD0s(d0.toFixed(2)); }} />
    </div>;
}
