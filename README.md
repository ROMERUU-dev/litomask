# LitoMask

Aplicación web para usar una impresora de resina MSLA Anycubic (por defecto la **Photon
Mono 2**, formato `.pm3n`) como equipo de exposición para fotolitografía sobre placas
fenólicas, silicio y vidrio. Todo corre en el navegador; no se sube nada a ningún servidor.

Funciones:

- **Máscara** desde PNG o SVG con ancho físico en mm, umbral, polaridad, inversión,
  desplazamiento, rotación y espejo.
- **Dosis** por tiempo × número de pulsos, con pausa entre pulsos (el firmware no permite
  regular la intensidad del LED desde el archivo).
- **Corrección de proximidad (OPC)**: serifs en esquinas convexas, anti-serifs en cóncavas,
  sesgo global, y OPC iterativo por modelo.
- **Doble patronado A/B** por coloreado del grafo de conflictos, con marcas de alineación
  cruz-en-caja y archivo de alineación.
- **Simulación** de exposición (gaussiana σ + umbral D₀/D) con vistas de diseño, máscara,
  A/B, simulación e imagen aérea.
- **Calibración**: patrón de prueba con matriz de dosis en un solo archivo y ajuste de σ y
  D₀ a partir de tus mediciones.
- Escritor propio de archivos Anycubic (versiones 1, 515, 516 y 517) verificado con UVtools.
- Interfaz en **español, inglés y ruso** con selector de idioma (se recuerda en el navegador).

**Usar en línea**: https://romeruu-dev.github.io/litomask/ (se despliega solo desde `main`).

Documentación y protocolo de calibración: [docs/litografia.md](docs/litografia.md).
Guía impresa de calibración con microscopio (PDF): [docs/Guia_calibracion_LitoMask_Nikon_Eclipse.pdf](docs/Guia_calibracion_LitoMask_Nikon_Eclipse.pdf).

## Uso

```bash
npm install
npm run dev        # servidor de desarrollo en http://localhost:5173
npm test           # pruebas unitarias (vitest)
npm run build      # versión estática en dist/
```

La carpeta `dist/` es estática: se puede servir con cualquier servidor web (nginx, Apache,
`python -m http.server`) sin backend. Para servirla bajo una subruta (como en GitHub Pages)
exporta `VITE_BASE=/subruta/` antes de `npm run build`.

## Impresoras

Photon Mono 2 (`.pm3n`), Photon Ultra, M3, M3 Max, Mono SQ, Zero, Mono 4K, Mono X 6K /
M3 Plus, Mono, Mono SE, Mono X, Photon / Photon S, Photon X. Las definiciones están en
`src/formats/printers.ts`.

## Estructura

- `src/core/` — núcleo en TypeScript puro: bitmaps, OPC, división A/B, simulación y
  ajuste, patrón de calibración, rasterizado, ensamblado de trabajos.
- `src/formats/` — escritor de archivos Anycubic y lista de impresoras.
- `src/worker/` — Web Worker que ejecuta las operaciones pesadas fuera del hilo de la interfaz.
- `src/ui/` — interfaz (React + Bootstrap).
- `src/i18n/` — diccionarios de traducción tipados (`es.ts` es la referencia; `en.ts` y `ru.ts`
  deben implementar las mismas claves, TypeScript lo comprueba).

## Créditos

- Inspirado en [Photonic Etcher](https://github.com/Andrew-Dickinson/photonic-etcher) de
  Andrew Dickinson (MIT), que demostró el uso de impresoras Anycubic como equipo de
  exposición para PCB a partir de Gerbers. LitoMask nació como un modo adicional de esa
  aplicación y se separó como proyecto propio.
- El layout binario de los archivos Anycubic se tomó como referencia de
  [UVtools](https://github.com/sn4k3/UVtools) de Tiago Conceição, y UVtoolsCmd se usó para
  verificar los archivos generados.

## Licencia

MIT. Ver [LICENSE](LICENSE).
