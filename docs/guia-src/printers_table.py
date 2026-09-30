"""Builds the per-printer table (appendix B.2) from the app's printer list, so the PDF never drifts from the code."""
import json
import re
import sys

src = open(sys.argv[1]).read()
outfile = sys.argv[2]
rows = []
for m in re.finditer(r"'([^']+)': \{(.*?)\n    \}", src, re.S):
    name, body = m.group(1), m.group(2)
    res = re.search(r'"resolution": \[(\d+), (\d+)\]', body)
    xy = float(re.search(r'"xyRes": ([\d.]+)', body).group(1))
    fmt = re.search(r'"fileFormat": "(\w+)"', body).group(1)
    W, H = int(res.group(1)), int(res.group(2))
    um = xy * 1000
    P = 380
    cols = max(1, min(10, W // P))
    maxrows = max(1, H // P)
    cells = min(10, cols * maxrows)
    rows_ = -(-cells // cols)
    clean = re.sub(r" \(\..*\)$", "", name.replace("AnyCubic ", ""))
    rows.append((clean, f".{fmt}", f"{W} × {H}", f"{um:.1f}", f"{100 * um:.0f}", f"{cells}", f"{cols * P * xy:.0f} × {rows_ * P * xy:.0f}"))
json.dump(rows, open(outfile, "w"), ensure_ascii=False, indent=1)
print(f"{len(rows)} printers")
