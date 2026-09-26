import { useMemo, useState } from "react";
import { Button, Form, Modal, Table, Alert } from "react-bootstrap";
import { fitCalibration } from "../core/simulate";
import type { CalibrationPoint } from "../core/simulate";
import { useI18n } from "../i18n";

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
    const { t } = useI18n();
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
        <Modal.Header closeButton><Modal.Title>{t.fitTitle}</Modal.Title></Modal.Header>
        <Modal.Body>
            <p className={"small"}>{t.fitHelp(timePerLayer)}</p>
            <Form.Group className={"mb-2"}>
                <Form.Label>{t.nominalWidth}</Form.Label>
                <Form.Control size={"sm"} value={nominal} onChange={e => setNominal(e.target.value)} style={{ maxWidth: 160 }} />
            </Form.Group>
            <Table size={"sm"} bordered>
                <thead><tr><th>{t.colCell}</th><th>{t.colDose}</th><th>{t.colMeasured}</th><th>{t.colPredicted}</th></tr></thead>
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
                    <b>{t.fitResult(fit.sigma.toFixed(1), (fit.sigma / pixelUm).toFixed(2), fit.d0.toFixed(2), fit.rms.toFixed(1))}</b>
                    <div className={"small mt-1"}>
                        {t.fitHint((4 * fit.sigma / pixelUm).toFixed(1), (5 * fit.sigma / pixelUm).toFixed(1))}
                    </div>
                </Alert>
                : <Alert variant={"secondary"}>{t.fitNeed}</Alert>}
        </Modal.Body>
        <Modal.Footer>
            <Button variant={"secondary"} onClick={onHide}>{t.close}</Button>
            <Button disabled={!fit} onClick={() => { if (fit) { onApply(fit.sigma, fit.d0); onHide(); } }}>{t.useValues}</Button>
        </Modal.Footer>
    </Modal>;
}
