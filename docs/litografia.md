# Modo litografía (máscara)

LitoMask convierte una imagen de máscara (PNG o SVG) en un archivo de impresión para
impresoras Anycubic (por defecto la **Photon Mono 2**, formato `.pm3n`) pensado para
fotolitografía sobre placas fenólicas, silicio o vidrio: el sustrato con fotorresina se
apoya boca abajo directamente sobre la pantalla LCD (sin cubeta) y la impresora "imprime"
una o varias capas idénticas que exponen la máscara.

Todo se procesa en el navegador; no se sube nada a ningún servidor.

## Flujo básico

1. **Impresora**: elige el modelo. Debajo aparece la resolución, el tamaño de píxel
   (35 µm en la Mono 2) y el área útil.
2. **Máscara**: carga un PNG/SVG y escribe su ancho físico en mm. Si el SVG trae `width`
   en mm se toma automáticamente. Ajusta umbral, polaridad (claro = expuesto o no),
   inversión, desplazamiento, rotación y espejo.
   La vista previa muestra la máscara **tal como la verás sobre la resina mirándola de
   frente**. Compruébalo la primera vez con la "F" del patrón de calibración.
3. **Corrección (OPC)**: opcional, ver abajo.
4. **Doble patronado**: opcional, ver abajo.
5. **Exposición y exportar**: tiempo por pulso, número de pulsos y pausa entre pulsos.
   La dosis total es `tiempo × pulsos`. Se exporta un `.pm3n` de N capas idénticas con
   altura de capa 0.05 mm y elevación 0. Copia el archivo a la USB e "imprime" sin
   plataforma ni cubeta.

Notas prácticas:

- La impresora no permite regular la intensidad del LED desde el archivo (el firmware
  ignora ese campo). La dosis se controla con tiempo y pulsos. Si tu firmware tiene
  "UV Power" en Tools › Settings, ese ajuste es global de la máquina.
- La luz no está colimada: cualquier separación entre resina y pantalla se convierte en
  desenfoque. Apoya la resina en contacto con la película protectora del LCD.
- Los archivos escriben una miniatura para la pantalla de la impresora.

## Corrección de proximidad (OPC)

El desenfoque redondea esquinas convexas y rellena las cóncavas, y acorta los extremos
de línea. Dos correcciones:

- **Por reglas**: un cuadrado ("serif") de `s` píxeles centrado en cada esquina convexa,
  un cuadrado que se quita en cada esquina cóncava, y un sesgo global en píxeles.
  Los serifs en los dos vértices de un extremo de línea funcionan como "hammerhead".
  Empieza con 1 o 2 px y verifica con el patrón de calibración (tiene un cuadrado con
  y sin serifs).
- **Por modelo**: usa σ y D₀ de la sección de simulación. Simula la exposición
  (máscara ⊗ gaussiana, umbral D₀/D), compara con el diseño y mueve píxeles dentro de
  una banda alrededor de los bordes durante N iteraciones. Es experimental; revisa el
  resultado en la vista "Máscara corregida" y en "Simulación".

## Doble patronado (A / B)

Divide el diseño en dos máscaras de modo que dos figuras más cercanas que la distancia
indicada nunca queden en la misma máscara (coloreado a dos colores del grafo de
conflictos; si hay ciclos impares se avisa y esas figuras quedan en A).

**Importante**: en una sola capa de resina la dosis es aditiva y dividir no gana nada.
El flujo que sí funciona es: exponer A → revelar → grabar o endurecer → recubrir →
exponer B → revelar → grabar. Cada exposición resuelve figuras al doble de separación.

Se exportan `nombre_A`, `nombre_B` y `nombre_alineacion` en un ZIP. Las marcas de
alineación son cruces en A y cajas en B (caja-en-cruz) en las cuatro esquinas del campo.
El archivo de alineación muestra cruz y caja juntas durante el tiempo indicado (por
defecto 300 s) para alinear el sustrato a ojo con la pantalla encendida; protege la
resina del resto del sustrato durante esa maniobra o deja la zona de marcas sin resina.

## Simulación

Modelo de exposición: imagen aérea `I = máscara ⊗ G(σ)`; la resina revela donde
`D · I ≥ D₀`, es decir `I ≥ D₀/D`. La vista "Simulación" pinta en rojo lo que el diseño
pide y no se expone, en cian lo que se expone de más y en blanco lo que coincide.
"Imagen aérea" muestra `I` en escala de gris.

## Calibración manual de σ y D₀ (protocolo)

Necesitas medir dos números de tu proceso: el desenfoque σ (en µm) y la dosis mínima
D₀ (en segundos de exposición). Con ellos la simulación y el OPC por modelo predicen
lo que saldrá.

1. En **1 · Máscara** pulsa **Patrón de calibración**. Elige el número de celdas K
   (10 por defecto) y el tiempo por capa `t` (por ejemplo 3 s). La celda k recibe
   dosis `k·t`. Conviene que el rango cubra desde "no revela" hasta 4 o 5 veces D₀; si
   no sabes D₀, haz una primera pasada con t grande (p. ej. 5 s) y repite más fino.
2. Cada celda contiene: número de celda, una "F" de orientación, un **cuadro grande de
   100 px (3500 µm en la Mono 2)**, líneas aisladas de 1, 2, 3, 4, 6 y 8 px, rejillas
   verticales y horizontales de paso 2, 3, 4, 6, 8, 12 y 16 px, un cuadrado sin y con
   serifs, un extremo de línea sin y con hammerhead, y pares de líneas de 4 px con
   separaciones de 1 a 4 px.
3. **Exportar**: se genera un único `.pm3n` de K capas (`calibracion_matriz_dosis_…`).
   Exponlo con tu resina, espesor, sustrato y revelado habituales.
4. Mide en cada celda el **ancho del cuadro grande** en µm (escáner plano a 2400 o
   4800 dpi para fenólica y vidrio; microscopio con micrómetro de platina para silicio).
   Anota también el paso de rejilla más fino que se resolvió limpio y si la "F" salió
   espejada o girada (corrige con Espejo/Rotación en la sección 1).
5. En **4 · Simulación y calibración** pulsa **Ajustar σ y D₀ con mediciones**, escribe
   el ancho medido de cada celda (deja vacías las que no revelaron) y el ancho nominal
   (3500 µm por defecto). El ajuste usa

       w(D) = w₀ + 2·σ·√2·erf⁻¹(1 − 2·D₀/D)

   con búsqueda en D₀ y mínimos cuadrados en σ. Muestra σ, D₀ y el error RMS; con
   **Usar σ y D₀ en la simulación** se copian a la sección 4.
6. Comprobación: el paso de rejilla más fino resuelto debería estar entre 4σ y 5σ. Para
   estas pantallas en contacto, σ típico es 35 a 70 µm (1 a 2 px). Si sale mucho mayor,
   hay gap o suciedad entre resina y pantalla.

Para resina **positiva** el "ancho" es el de la zona revelada de una figura expuesta;
para **negativa** es el ancho de la figura que queda. La fórmula es la misma.

## Formato de archivo

El escritor (`src/formats/anycubic.ts`) genera los contenedores Anycubic
versión 1, 515, 516 y 517 (`.pm3n`, Mono 2) según el layout de UVtools. Los archivos
generados se verificaron abriéndolos con UVtoolsCmd 7.0: todas las secciones se
reconocen y las capas decodifican píxel a píxel idénticas al original.
