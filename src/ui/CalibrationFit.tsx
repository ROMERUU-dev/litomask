import { useMemo, useState } from "react";
import { Button, Form, Modal, Table, Alert } from "react-bootstrap";
import { fitCalibration } from "../core/simulate";
import type { CalibrationPoint } from "../core/simulate";

interface Props {
    show: boolean;
    onHide: () => void;
    /** Exposure time per layer used in the dose-matrix file (s). */
    timePerLayer: number;
    /** Number of cells in the dose matrix. */
    cells: number;
    /** Nominal width of the measured feature (µm). */
    nominalWidthUm: number;
    pixelUm: number;
    onApply: (sigmaUm: number, d0s: number) => void;
}

/**
 * Manual calibration: the user types the measured width of the large square (or a line)
 * in every cell of the dose matrix; we fit sigma (blur) and D0 (dose-to-clear).
 */
export default function CalibrationFit(props: Props) {
    const { show, onHide, timePerLayer, cells, nominalWidthUm, pixelUm, onApply } = props;
    const [nominal, setNominal] = useState(String(nominalWidthUm));
    const [widths, setWidths] = useState<string[]>(() => Array(cells).fill(""));

    if (widths.length !== cells) setWidths(Array(cells).fill(""));

    const points: CalibrationPoint[] = useMemo(() => widths
        .map((w, i) => ({ dose: (i + 1) * timePerLayer, width: parseFloat(w) }))
        .filter(p => isFinite(p.width) && p.width > 0), [widths, timePerLayer]);

    const fit = useMemo(() => {
        const w0 = parseFloat(nominal);
        if (!isFinite(w0) || points.length < 3) return null;
        return fitCalibration(points, w0);
    }, [points, nominal]);

    return <Modal show={show} onHide={onHide} size={"lg"}>
        <Modal.Header closeButton><Modal.Title>Ajuste de calibración (σ y D₀)</Modal.Title></Modal.Header>
        <Modal.Body>
            <p className={"small"}>
                Mide el ancho impreso del cuadro grande (o de la línea de 8 px) en cada celda de la matriz de dosis y
                escríbelo en micras. Deja vacías las celdas que no revelaron. La celda k recibió k × {timePerLayer} s.
                Modelo: w(D) = w₀ + 2·σ·√2·erf⁻¹(1 − 2·D₀/D).
            </p>
            <Form.Group className={"mb-2"}>
                <Form.Label>Ancho nominal w₀ (µm)</Form.Label>
                <Form.Control size={"sm"} value={nominal} onChange={e => setNominal(e.target.value)} style={{ maxWidth: 160 }} />
            </Form.Group>
            <Table size={"sm"} bordered>
                <thead><tr><th>Celda</th><th>Dosis (s)</th><th>Ancho medido (µm)</th><th>Ancho según ajuste (µm)</th></tr></thead>
                <tbody>
                    {widths.map((w, i) => {
                        const idx = points.findIndex(p => p.dose === (i + 1) * timePerLayer);
                        return <tr key={i}>
                            <td>{i + 1}</td>
                            <td>{((i + 1) * timePerLayer).toFixed(2)}</td>
                            <td><Form.Control size={"sm"} value={w} onChange={e => {
                                const nw = [...widths]; nw[i] = e.target.value; setWidths(nw);
                            }} /></td>
                            <td>{fit && idx >= 0 ? fit.predicted[idx].toFixed(1) : ""}</td>
                        </tr>;
                    })}
                </tbody>
            </Table>
            {fit ?
                <Alert variant={"success"}>
                    σ = <b>{fit.sigma.toFixed(1)} µm</b> ({(fit.sigma / pixelUm).toFixed(2)} px) ·
                    D₀ = <b>{fit.d0.toFixed(2)} s</b> · RMS = {fit.rms.toFixed(1)} µm
                    <div className={"small mt-1"}>
                        Con dosis D, el umbral normalizado de la simulación es D₀/D. El paso de rejilla más fino que
                        resolvió debería quedar entre {(4 * fit.sigma / pixelUm).toFixed(1)} y {(5 * fit.sigma / pixelUm).toFixed(1)} px.
                    </div>
                </Alert>
                : <Alert variant={"secondary"}>Se necesitan al menos 3 celdas medidas.</Alert>}
        </Modal.Body>
        <Modal.Footer>
            <Button variant={"secondary"} onClick={onHide}>Cerrar</Button>
            <Button disabled={!fit} onClick={() => { if (fit) { onApply(fit.sigma, fit.d0); onHide(); } }}>Usar σ y D₀ en la simulación</Button>
        </Modal.Footer>
    </Modal>;
}
