#!/usr/bin/env bash
# Regenerates docs/Guia_calibracion_LitoMask_Nikon_Eclipse.pdf from the sources in this folder.
#   docs/guia-src/build.sh            (needs node + python3 with venv support; installs reportlab/matplotlib in ~/.cache/litomask-pdf-venv)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"
VENV="${LITOMASK_PDF_VENV:-$HOME/.cache/litomask-pdf-venv}"

mkdir -p "$BUILD"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv --system-site-packages "$VENV"
  "$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
fi
"$VENV/bin/python" -c "import reportlab, matplotlib, PIL, numpy" 2>/dev/null || "$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"

( cd "$HERE" && node render_pattern.js "$BUILD" )
"$VENV/bin/python" "$HERE/printers_table.py" "$ROOT/src/formats/printers.ts" "$BUILD/printers_table.json"
"$VENV/bin/python" "$HERE/figs.py" "$BUILD"
"$VENV/bin/python" "$HERE/build_pdf.py" "$BUILD" "$ROOT/docs/Guia_calibracion_LitoMask_Nikon_Eclipse.pdf"
echo "PDF: $ROOT/docs/Guia_calibracion_LitoMask_Nikon_Eclipse.pdf"
