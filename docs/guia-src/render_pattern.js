// Renders the real calibration pattern (Mono 2 resolution) and one cell to raw bitmaps,
// using the app's own TypeScript sources. Run from docs/guia-src with:  node render_pattern.js <outdir>
// The project package.json declares "type": "module", so this file is ESM; the transpiled
// core modules are CommonJS and get loaded through createRequire.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ts = require(path.join(__dirname, "..", "..", "node_modules", "typescript"));

const outdir = process.argv[2] || "build";
fs.mkdirSync(path.join(outdir, "out", "core"), { recursive: true });
const root = path.join(__dirname, "..", "..", "src");
for (const f of ["core/bitmap.ts", "core/testpattern.ts"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    // .cjs so Node loads them as CommonJS even under a "type": "module" package
    fs.writeFileSync(path.join(outdir, "out", f.replace(".ts", ".cjs")), out.outputText.replace(/require\("\.\/bitmap"\)/g, 'require("./bitmap.cjs")'));
}
const { generateTestPattern, defaultTestPatternOptions, renderCell } = require(path.resolve(outdir, "out/core/testpattern.cjs"));
const tp = generateTestPattern(4096, 2560, defaultTestPatternOptions);
fs.writeFileSync(path.join(outdir, "pattern_all.raw"), Buffer.from(tp.all.data));
const cell = renderCell(3, defaultTestPatternOptions);
fs.writeFileSync(path.join(outdir, "cell.raw"), Buffer.from(cell.data));
fs.writeFileSync(path.join(outdir, "cell.json"), JSON.stringify({ w: cell.width, h: cell.height, all: [tp.all.width, tp.all.height], positions: tp.positions }));
console.log("pattern rendered:", tp.all.width, "x", tp.all.height, "cell", cell.width, "x", cell.height);
