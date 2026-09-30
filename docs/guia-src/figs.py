"""Figures for the calibration guide. Run from the build directory created by build.sh:
    python figs.py <builddir>
Expects pattern_all.raw / cell.raw / cell.json produced by render_pattern.js in <builddir>.
"""
import json
import os
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon
from matplotlib.lines import Line2D
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from helpers import gaussian_blur2d, erfinv, render_F  # noqa: E402

B = sys.argv[1] if len(sys.argv) > 1 else "build"
os.chdir(B)
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.linewidth": 0.8})
DPI = 220

# ---------------------------------------------------------------- pattern bitmaps -> PNG
meta = json.load(open("cell.json"))
W, H = meta["all"]
full = np.frombuffer(open("pattern_all.raw", "rb").read(), dtype=np.uint8).reshape(H, W)
Image.fromarray(full).save("pattern_full.png")
cell = np.frombuffer(open("cell.raw", "rb").read(), dtype=np.uint8).reshape(meta["h"], meta["w"])
cell3 = np.array(Image.fromarray(cell).resize((meta["w"] * 3, meta["h"] * 3), Image.NEAREST))

# ---------------------------------------------------------------- 1. montaje
fig, ax = plt.subplots(figsize=(6.4, 3.0))
ax.set_xlim(0, 10); ax.set_ylim(0, 5); ax.axis("off")
layers = [
    (0.3, 0.55, "#d9d9d9", "Matriz de LED 405 nm + lente"),
    (1.15, 0.35, "#9fc5e8", "Panel LCD monocromo"),
    (1.55, 0.12, "#f6d28c", "Película protectora de la pantalla"),
    (1.72, 0.18, "#e06666", "Fotorresina (boca abajo)"),
    (1.95, 0.7, "#b7b7b7", "Sustrato: fenólica, silicio o vidrio"),
]
label_y = [0.55, 1.2, 1.62, 2.05, 2.6]
for (y, h, c, lab), ly in zip(layers, label_y):
    ax.add_patch(Rectangle((1.0, y), 5.4, h, facecolor=c, edgecolor="k", lw=0.6))
    ax.plot([6.4, 6.75], [y + h / 2, ly], color="#555", lw=0.6)
    ax.text(6.85, ly, lab, va="center", fontsize=8.2)
for x in (2.2, 3.7, 5.2):
    ax.add_patch(Polygon([(x, 1.5), (x - 0.35, 1.72), (x + 0.35, 1.72)], closed=True, facecolor="#b19cd9", alpha=0.6, edgecolor="none"))
    ax.add_patch(Rectangle((x - 0.05, 1.15), 0.1, 0.35, facecolor="#3d3d8f", edgecolor="none"))
# label between the first two pixels so the drawn pixel does not cut the text
ax.text(2.95, 1.32, "píxel encendido", ha="center", va="center", fontsize=7, color="white")
ax.annotate("la luz diverge: cualquier hueco entre\nresina y pantalla la desenfoca", xy=(5.3, 1.62), xytext=(1.2, 3.2), fontsize=8,
            arrowprops=dict(arrowstyle="->", lw=0.8, connectionstyle="arc3,rad=-0.25"), ha="left")
ax.text(1.0, 3.9, "Sin cubeta ni plataforma. Un peso ligero sobre el sustrato mantiene el contacto.", fontsize=8, style="italic")
ax.text(1.0, 4.5, "Corte transversal del montaje de exposición", fontsize=10, weight="bold")
fig.savefig("fig_montaje.png", dpi=DPI, bbox_inches="tight"); plt.close(fig)

# ---------------------------------------------------------------- 2. desenfoque
sigma = 6.0
mask = np.zeros((160, 160)); mask[40:120, 40:120] = 1
I = gaussian_blur2d(mask, sigma)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.4, 2.9), gridspec_kw=dict(width_ratios=[1, 1.25]))
a1.imshow(I, cmap="gray", vmin=0, vmax=1, origin="lower")
iso_colors = {0.25: "#e69138", 0.5: "#e06666", 0.75: "#6aa84f"}
a1.contour(I, levels=list(iso_colors), colors=list(iso_colors.values()), linewidths=1.0)
a1.add_patch(Rectangle((40, 40), 80, 80, fill=False, edgecolor="#4a86e8", lw=1.0, ls="--"))
# the three isodose contours are only a few px apart, so inline labels overlap: use a legend instead
a1.legend(handles=[Line2D([], [], color=c, lw=1.2, label=f"{int(v * 100)} %") for v, c in iso_colors.items()],
          loc="upper center", ncol=3, fontsize=6.5, frameon=True, framealpha=0.9, handlelength=1.2,
          columnspacing=0.9, handletextpad=0.4, borderpad=0.3, title="isodosis", title_fontsize=6.5)
a1.set_xticks([]); a1.set_yticks([])
a1.set_title("Dosis relativa que recibe la resina\n(línea azul punteada: diseño)", fontsize=8.5)
a1.text(80, 8, "borde recto: 50 %  ·  esquina: 25 %", ha="center", fontsize=7, color="white")
x = np.arange(160)
a2.plot(x, mask[80], color="#4a86e8", ls="--", lw=1, label="máscara (diseño)")
a2.plot(x, I[80], color="k", lw=1.3, label="dosis relativa I(x)")
a2.axhline(0.5, color="#e06666", lw=0.8, ls=":")
# threshold label and legend go inside the plateau (x 55-105), where nothing else is drawn below y = 1
a2.text(80, 0.53, "umbral D₀/D = 0.5", fontsize=7.5, color="#e06666", ha="center")
a2.annotate("", xy=(120 - sigma, 0.16), xytext=(120 + sigma, 0.16), arrowprops=dict(arrowstyle="<->", lw=0.8))
a2.text(120, 0.06, "≈ 2σ", ha="center", fontsize=8)
a2.set_xlim(20, 150); a2.set_ylim(-0.02, 1.08); a2.set_xlabel("posición (px)"); a2.set_ylabel("dosis relativa")
a2.legend(fontsize=7, loc="lower center", bbox_to_anchor=(0.46, 0.02), frameon=False)
a2.set_title("Perfil a lo largo de la línea media", fontsize=8.5)
fig.tight_layout(); fig.savefig("fig_desenfoque.png", dpi=DPI, bbox_inches="tight"); plt.close(fig)


# ---------------------------------------------------------------- 3. curva w(D)
def w_of(D, w0, s, d0):
    D = np.asarray(D, float)
    out = np.full_like(D, np.nan)
    ok = D > d0
    out[ok] = w0 + 2 * s * np.sqrt(2) * erfinv(1 - 2 * d0 / D[ok])
    return out


D = np.linspace(3, 32, 400)
fig, ax = plt.subplots(figsize=(6.4, 3.2))
for s, c, lab in ((50, "#c0392b", "σ = 50 µm"), (100, "#2e86c1", "σ = 100 µm")):
    ax.plot(D, w_of(D, 3500, s, 4.0), color=c, lw=1.4, label=lab + ", D₀ = 4 s")
ax.plot(D, w_of(D, 3500, 50, 8.0), color="#c0392b", lw=1.1, ls="--", label="σ = 50 µm, D₀ = 8 s")
Dk = np.arange(1, 11) * 3.0
rng = np.random.default_rng(3)
pts = w_of(Dk, 3500, 50, 4.0) + rng.normal(0, 6, Dk.size)
ax.plot(Dk, pts, "o", color="k", ms=4, label="mediciones (ejemplo)")
ax.axhline(3500, color="gray", lw=0.7, ls=":"); ax.text(30.5, 3503, "w₀ nominal", fontsize=7.5, color="gray", ha="right")
# x axis starts at 0 so the "no revela" band (D < D₀ = 4 s) is fully visible; label rotated to fit inside it
ax.axvspan(0, 4, color="#f4cccc", alpha=0.5)
ax.text(2.0, 3510, "no revela (D < D₀)", fontsize=7.5, ha="center", va="center", rotation=90, color="#990000")
ax.set_xlim(0, 32); ax.set_ylim(3360, 3660)
ax.set_xlabel("dosis D (s)"); ax.set_ylabel("ancho impreso del cuadro (µm)")
ax.legend(fontsize=7.5, frameon=False, loc="lower right")
ax.set_title("Ancho impreso contra dosis: la pendiente da σ, el arranque da D₀", fontsize=9)
fig.tight_layout(); fig.savefig("fig_curva.png", dpi=DPI, bbox_inches="tight"); plt.close(fig)

# ---------------------------------------------------------------- 4. celda anotada
fig, ax = plt.subplots(figsize=(6.4, 5.0))
ax.imshow(cell3, cmap="gray", vmin=0, vmax=255, interpolation="nearest")
ax.set_xticks([]); ax.set_yticks([])
notes = [
    ("número de celda", (60, 60), (1180, 40)),
    ("«F» de orientación", (150, 90), (1180, 130)),
    ("cuadro grande de 100 px\n(3500 µm en la Mono 2): es el que se mide", (270, 270), (1180, 260)),
    ("líneas aisladas de\n1, 2, 3, 4, 6 y 8 px", (540, 330), (1180, 400)),
    ("rejillas verticales de paso\n2, 3, 4, 6, 8, 12 y 16 px", (860, 560), (1180, 530)),
    ("rejillas horizontales", (860, 770), (1180, 680)),
    ("cuadrado sin y con serifs,\nextremo sin y con hammerhead,\npares de líneas con hueco de 1 a 4 px", (610, 905), (1180, 850)),
]
for text, xy, xt in notes:
    ax.annotate(text, xy=xy, xytext=xt, fontsize=7.5, color="#ffd966",
                arrowprops=dict(arrowstyle="->", color="#ffd966", lw=0.8), ha="left", va="center",
                bbox=dict(boxstyle="round,pad=0.2", fc="black", ec="none", alpha=0.6))
ax.set_xlim(0, cell3.shape[1] + 700); ax.set_ylim(cell3.shape[0] - 120, -10)
ax.set_facecolor("black")
fig.patch.set_facecolor("black")
fig.tight_layout(); fig.savefig("fig_celda.png", dpi=DPI, bbox_inches="tight", facecolor="black"); plt.close(fig)

# ---------------------------------------------------------------- 5. patrón completo
fig, ax = plt.subplots(figsize=(6.4, 4.0))
ax.imshow(full, cmap="gray", vmin=0, vmax=255, interpolation="antialiased")
ax.set_xticks([0, 1024, 2048, 3072, 4096]); ax.set_yticks([0, 1280, 2560])
ax.set_xlabel("píxeles de la pantalla (Mono 2: 35 µm cada uno, 143.4 mm de ancho)"); ax.set_ylabel("píxeles")
ax.tick_params(labelsize=7)
for k, p in enumerate(meta["positions"], 1):
    ax.text(p["x"], p["y"] - 230, f"{k}·t", ha="center", fontsize=7, color="#ffd966")
ax.set_title("Patrón completo tal como lo muestra la pantalla; la celda k recibe k veces el tiempo t", fontsize=8.5)
fig.tight_layout(); fig.savefig("fig_patron.png", dpi=DPI, bbox_inches="tight"); plt.close(fig)

# ---------------------------------------------------------------- 6. microscopio: cómo medir
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.4, 3.1))
a1.set_xlim(-0.3, 4.3); a1.set_ylim(-0.3, 4.3); a1.set_aspect("equal"); a1.axis("off")
a1.add_patch(plt.Circle((2, 2), 2.25, fill=False, lw=1.0, color="gray"))
a1.add_patch(Rectangle((0.6, 0.6), 2.8, 2.8, facecolor="#f3f3f3", edgecolor="#222", lw=1.2))
for y, lab in ((0.9, "abajo"), (2.0, "centro"), (3.1, "arriba")):
    a1.annotate("", xy=(0.6, y), xytext=(3.4, y), arrowprops=dict(arrowstyle="<->", lw=0.9, color="#c0392b"))
    a1.text(3.5, y, lab, fontsize=7, va="center", color="#c0392b")
a1.plot([2, 2], [-0.1, 4.1], color="#888", lw=0.5); a1.plot([-0.1, 4.1], [2, 2], color="#888", lw=0.5)
a1.set_title("Tres lecturas borde a borde\npor cuadro, se promedian", fontsize=8.5)
a2.set_xlim(0, 10); a2.set_ylim(0, 6); a2.axis("off")
a2.add_patch(Rectangle((2.5, 1.5), 5, 3, facecolor="#f3f3f3", edgecolor="#222", lw=1.2))
for x, lab, tx in ((2.5, "X₁", 1.4), (7.5, "X₂", 7.9)):
    a2.plot([x, x], [0.6, 5.2], color="#c0392b", lw=1.0, ls="--")
    a2.text(tx, 5.3, f"retículo en el borde → leer {lab}", fontsize=7, color="#c0392b")
a2.annotate("", xy=(2.5, 0.9), xytext=(7.5, 0.9), arrowprops=dict(arrowstyle="<->", lw=0.9))
a2.text(5, 0.3, "ancho = |X₂ − X₁| (lectura de la platina)", ha="center", fontsize=7.5)
a2.set_title("Para cuadros que no caben en el campo:\ndesplazar la platina con el retículo en cruz", fontsize=8.5)
fig.tight_layout(); fig.savefig("fig_microscopio.png", dpi=DPI, bbox_inches="tight"); plt.close(fig)

# ---------------------------------------------------------------- 7. orientación con la F
F = render_F()
cases = [("como se ve en la app", lambda a: a, "correcto, no cambiar nada"),
         ("F al revés (izquierda-derecha)", lambda a: a[:, ::-1], "activar «Espejo X»"),
         ("F cabeza abajo", lambda a: a[::-1, :], "activar «Espejo Y»"),
         ("F girada 180°", lambda a: a[::-1, ::-1], "rotación 180°")]
fig, axs = plt.subplots(1, 4, figsize=(6.4, 2.2))
for ax, (title, f, fix) in zip(axs, cases):
    ax.imshow(f(F), cmap="gray", vmin=0, vmax=255, interpolation="nearest")
    ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(title, fontsize=7.5)
    ax.set_xlabel(fix, fontsize=7.5, color="#c0392b")
fig.suptitle("Lo que ves en la resina (mirándola de frente) y qué ajustar en la app", fontsize=8.5)
fig.tight_layout(); fig.savefig("fig_orientacion.png", dpi=DPI, bbox_inches="tight"); plt.close(fig)
print("figures ok")
