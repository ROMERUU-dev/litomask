/**
 * Diccionario de referencia (español). Los demás idiomas deben implementar `Strings`.
 */
const es = {
    langName: "Español",

    // App
    appTitle: "LitoMask",
    appSubtitle: "máscaras de fotolitografía para impresoras MSLA",
    language: "Idioma",

    // Printer
    printer: "Impresora",
    printerInfo: (w: number, h: number, um: string, wmm: string, hmm: string) => `${w} × ${h} px · ${um} µm/px · ${wmm} × ${hmm} mm`,

    // Sections
    sec1: "1 · Máscara",
    sec2: "2 · Corrección de proximidad (OPC)",
    sec3: "3 · Doble patronado (A / B)",
    sec4: "4 · Simulación y calibración",
    sec5: "5 · Exposición y exportar",
    sec6: "6 · Enviar a la impresora",

    // Mask source
    loadImage: "Cargar PNG / SVG",
    testPattern: "Patrón de calibración",
    imageInfo: (name: string, w: number, h: number) => `${name} · ${w} × ${h} px de imagen`,
    widthMm: "Ancho físico (mm)",
    threshold: "Umbral de luminancia (0-255)",
    brightIsExposed: "Los píxeles claros son los expuestos",
    invert: "Invertir (tono negativo)",
    offsetX: "Desplazamiento X (mm)",
    offsetY: "Desplazamiento Y (mm)",
    rotation: "Rotación",
    mirrorX: "Espejo X",
    mirrorY: "Espejo Y",
    orientationHint: "La imagen tal como se ve aquí es lo que verás sobre la resina mirándola de frente (el sustrato va boca abajo sobre la pantalla). Confírmalo con la \"F\" del patrón de calibración.",

    // Test pattern
    cells: "Celdas (pasos de dosis)",
    cellPitch: "Paso entre celdas (px)",
    timePerLayer: "Tiempo por capa t (s)",
    testInfo: (t: number, max: number, sq: number, um: string, lines: string, pitches: string) =>
        `La celda k recibe k × t = ${t} … ${max} s. Cuadro grande: ${sq} px = ${um} µm. Líneas de ${lines} px; rejillas de paso ${pitches} px.`,

    // OPC
    convexSerif: "Serif en esquinas convexas (px)",
    concaveSerif: "Anti-serif en esquinas cóncavas (px)",
    bias: "Sesgo global (px, + ensancha)",
    modelOpc: "OPC por modelo (usa σ y D₀ de la simulación)",
    iterations: "Iteraciones",
    band: "Banda de corrección (px)",
    applyOpc: "Aplicar corrección",
    maskReady: "máscara corregida lista",
    modelOpcInfo: (history: string) => `OPC por modelo: residuo ${history} px`,

    // Split
    splitHelp: "Separa en dos máscaras las figuras más cercanas que la distancia indicada. Solo sirve si entre A y B revelas, grabas o endureces y vuelves a recubrir; en una sola capa de resina la dosis se suma igual.",
    minDistance: "Distancia mínima entre figuras (px)",
    marks: "Marcas de alineación (cruz en A, caja en B)",
    markSize: "Tamaño de la cruz (px)",
    markLine: "Grosor de línea (px)",
    markInset: "Separación del campo (px)",
    alignTime: "Tiempo del archivo de alineación (s)",
    split: "Dividir",
    splitInfo: (a: number, b: number) => `Máscara A: ${a} figuras · Máscara B: ${b} figuras`,
    splitConflicts: (n: number) => ` · ${n} conflictos sin resolver (quedan en A)`,

    // Simulation
    sigma: "Desenfoque σ (µm)",
    d0: "Dosis mínima D₀ (s)",
    simInfo: (sigmaPx: string, dose: string, thr: string) => `σ = ${sigmaPx} px · dosis actual ${dose} s · umbral D₀/D = ${thr}`,
    simulate: "Simular",
    fitButton: "Ajustar σ y D₀ con mediciones",

    // Exposure / export
    testExportNote: "La matriz de dosis usa el tiempo por capa del patrón; aquí solo aplica la pausa.",
    pulseTime: "Tiempo por pulso (s)",
    pulses: "Número de pulsos",
    pause: "Pausa entre pulsos (s)",
    testSummary: (n: number, t: number) => `${n} capas × ${t} s`,
    doseSummary: (dose: string, pulses: number, total: string) => `Dosis total ${dose} s en ${pulses} pulso(s) · duración ≈ ${total} s`,
    zipNote: " · se exportan A, B y alineación en un ZIP",
    exportBtn: (ext: string) => `Exportar .${ext}`,

    // File names
    fileCalib: "calibracion",
    fileDoseMatrix: "matriz_dosis",
    fileAlign: "alineacion",

    // Busy / errors
    busyOpc: "Aplicando corrección...",
    busySplit: "Dividiendo máscara...",
    busySim: "Simulando exposición...",
    busyExport: "Generando archivos...",
    progressIter: (iter: number, residual: number) => `iteración ${iter}: residuo ${residual} px`,
    errImageLoad: "No se pudo cargar la imagen",

    // Views
    viewDesign: "Diseño",
    viewMask: "Máscara corregida",
    viewSplit: "A / B",
    viewSim: "Simulación",
    viewAerial: "Imagen aérea",
    legendSim: "rojo = diseño sin exponer, cian = expuesto de más, blanco = coincide",
    legendSplit: "naranja = máscara A, azul = máscara B",
    legendMask: "gris = diseño, azul claro = máscara con corrección",
    emptyHint: "Carga una máscara o genera el patrón de calibración",

    // Preview canvas
    zoomIn: "Acercar",
    zoomOut: "Alejar",
    fitView: "Ajustar a la ventana",
    zoomLabel: (z: string) => `zoom ${z}x`,
    cursorInfo: (px: number, py: number, mmx: string, mmy: string) => `px (${px}, ${py}) · mm (${mmx}, ${mmy}) desde el centro`,
    canvasHelp: "rueda: zoom · arrastrar: mover · doble clic: ajustar",

    // Calibration fit dialog
    fitTitle: "Ajuste de calibración (σ y D₀)",
    fitHelp: (t: number) => `Mide el ancho impreso del cuadro grande (o de la línea de 8 px) en cada celda de la matriz de dosis y escríbelo en micras. Deja vacías las celdas que no revelaron. La celda k recibió k × ${t} s. Modelo: w(D) = w₀ + 2·σ·√2·erf⁻¹(1 − 2·D₀/D).`,
    nominalWidth: "Ancho nominal w₀ (µm)",
    colCell: "Celda",
    colDose: "Dosis (s)",
    colMeasured: "Ancho medido (µm)",
    colPredicted: "Ancho según ajuste (µm)",
    fitResult: (sigma: string, px: string, d0: string, rms: string) => `σ = ${sigma} µm (${px} px) · D₀ = ${d0} s · RMS = ${rms} µm`,
    fitHint: (lo: string, hi: string) => `Con dosis D, el umbral normalizado de la simulación es D₀/D. El paso de rejilla más fino que resolvió debería quedar entre ${lo} y ${hi} px.`,
    fitNeed: "Se necesitan al menos 3 celdas medidas.",
    close: "Cerrar",
    useValues: "Usar σ y D₀ en la simulación",

    // Printer link (USB bridge)
    bridgeHelp: "Envía los archivos a un puente USB: una Raspberry Pi enchufada a la impresora que se comporta como una memoria USB. Cómo montarlo: pi/README.md en el repositorio.",
    bridgeUrl: "Dirección del puente",
    bridgeUrlHint: "Nombre o IP de la Pi (con el puerto si no es el 8080). Se recuerda en este navegador.",
    bridgeTest: "Probar conexión",
    bridgeReconnect: "Reconectar memoria",
    bridgeSend: "Enviar a la impresora",
    bridgeDelete: "Borrar",
    bridgeDeleteConfirm: (name: string) => `¿Borrar ${name} de la memoria USB?`,
    bridgeMixedContent: (url: string) => `Esta página se abrió por HTTPS y el navegador bloquea las llamadas a un puente por HTTP en la red local (contenido mixto). Abre LitoMask desde la propia Pi: ${url}`,
    bridgeModeGadget: "memoria USB",
    bridgeModeDev: "modo de prueba (sin USB)",
    bridgeExported: "visible para la impresora",
    bridgeNotExported: "desconectada de la impresora",
    bridgeStatusLine: (mode: string, label: string, exported: string, version: string) => `${mode} «${label}» · ${exported} · puente v${version}`,
    bridgeSpace: (free: string, total: string) => `Libre ${free} de ${total}`,
    bridgeFiles: "Archivos en la memoria:",
    bridgeNoFiles: "La memoria está vacía.",
    bridgeSentList: "Enviados:",
    bridgeSentHint: "La impresión se lanza desde la pantalla de la impresora: elige el archivo en la memoria USB y pulsa imprimir.",
    bridgeDone: (n: number) => `${n} archivo(s) enviado(s); la memoria USB se ha reconectado a la impresora.`,
    bridgeReconnected: "Memoria USB reconectada; la impresora debería volver a leerla.",
    busyBridgeTest: "Conectando con el puente...",
    busyBridgeReconnect: "Reconectando la memoria USB...",
    busyBridgeDelete: (name: string) => `Borrando ${name}...`,
    busyBridgeUpload: (i: number, n: number, name: string, pct: number) => `Enviando ${i}/${n}: ${name} · ${pct} %`,
    errBridgeUnreachable: (url: string) => `No se pudo conectar con el puente en ${url}. Comprueba que la Pi está encendida y en la misma red.`,
    errBridgeNotBridge: (url: string) => `${url} responde, pero no es un puente USB de LitoMask.`,
    errBridgeBusy: "El puente está ocupado con otra escritura; inténtalo de nuevo en unos segundos.",
    errBridgeNoSpace: "No hay espacio suficiente en la memoria USB: borra archivos y vuelve a intentarlo.",
    errBridgeNotFound: (name: string) => `${name} ya no está en la memoria USB.`,
    errBridgeBadName: (name: string) => `Nombre de archivo no válido para la memoria USB: ${name}`,
    errBridgeHttp: (status: number, detail: string) => `El puente respondió con el error ${status}${detail ? ` (${detail})` : ""}`,
};

export type Strings = typeof es;
export default es;
