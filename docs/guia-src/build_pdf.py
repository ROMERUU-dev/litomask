# -*- coding: utf-8 -*-
"""Builds the calibration guide PDF.  Usage: python build_pdf.py <builddir> <output.pdf>
<builddir> must contain the figures from figs.py and printers_table.json from printers_table.py."""
import json
import os
import sys

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, Table,
                                TableStyle, PageBreak, KeepTogether, ListFlowable, ListItem)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

BUILD = sys.argv[1] if len(sys.argv) > 1 else "build"
OUT = sys.argv[2] if len(sys.argv) > 2 else "Guia_calibracion_LitoMask_Nikon_Eclipse.pdf"
os.chdir(BUILD)

FD = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("Serif", FD + "DejaVuSerif.ttf"))
pdfmetrics.registerFont(TTFont("Serif-B", FD + "DejaVuSerif-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Serif-I", FD + "DejaVuSerif-Italic.ttf"))
pdfmetrics.registerFont(TTFont("Sans", FD + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("Sans-B", FD + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFontFamily("Serif", normal="Serif", bold="Serif-B", italic="Serif-I", boldItalic="Serif-B")
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-B", italic="Sans", boldItalic="Sans-B")

TITLE = "Calibración del sistema de exposición"
SUB = "Impresoras MSLA Anycubic + LitoMask · medición con microscopio Nikon Eclipse"
AUTHOR = "Juvenal Romero Pedraza · UABC"
DATE = "Septiembre de 2026 · versión 1.1"

body = ParagraphStyle("body", fontName="Serif", fontSize=10, leading=14.5, alignment=TA_JUSTIFY, spaceAfter=6)
small = ParagraphStyle("small", parent=body, fontSize=8.5, leading=11.5)
cap = ParagraphStyle("cap", parent=body, fontName="Sans", fontSize=8.2, leading=10.5, textColor=colors.HexColor("#444444"), alignment=TA_CENTER, spaceBefore=3, spaceAfter=10)
h1 = ParagraphStyle("h1", fontName="Sans-B", fontSize=14.5, leading=18, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1f3a5f"))
h2 = ParagraphStyle("h2", fontName="Sans-B", fontSize=11, leading=14, spaceBefore=9, spaceAfter=4, textColor=colors.HexColor("#1f3a5f"))
note = ParagraphStyle("note", parent=body, fontName="Serif-I", fontSize=9.3, leading=13, leftIndent=10, textColor=colors.HexColor("#333333"),
                      borderColor=colors.HexColor("#b7c7dd"), borderWidth=0.6, borderPadding=6, backColor=colors.HexColor("#f3f7fb"), spaceBefore=4, spaceAfter=10)
eq = ParagraphStyle("eq", parent=body, fontName="Serif-I", alignment=TA_CENTER, fontSize=11, spaceBefore=4, spaceAfter=8)
tcell = ParagraphStyle("tcell", fontName="Sans", fontSize=8, leading=10)
tcellb = ParagraphStyle("tcellb", parent=tcell, fontName="Sans-B")

W, H = letter


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Sans", 7.5)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawString(2 * cm, H - 1.3 * cm, "Guía de calibración · impresoras MSLA + LitoMask")
    canvas.drawRightString(W - 2 * cm, H - 1.3 * cm, "Medición con Nikon Eclipse")
    canvas.setStrokeColor(colors.HexColor("#b7c7dd"))
    canvas.setLineWidth(0.5)
    canvas.line(2 * cm, H - 1.45 * cm, W - 2 * cm, H - 1.45 * cm)
    canvas.drawCentredString(W / 2, 1.2 * cm, str(doc.page))
    canvas.restoreState()


def P(text, style=body):
    return Paragraph(text, style)


def fig(path, width_cm, caption):
    from PIL import Image as PILImage
    w, h = PILImage.open(path).size
    img = Image(path, width=width_cm * cm, height=width_cm * cm * h / w)
    return KeepTogether([img, P(caption, cap)])


def bullets(items, style=body):
    return ListFlowable([ListItem(P(i, style), leftIndent=12) for i in items], bulletType="bullet", start="–", leftIndent=14, bulletFontName="Serif")


def numbered(items, style=body):
    return ListFlowable([ListItem(P(i, style), leftIndent=14) for i in items], bulletType="1", leftIndent=16, bulletFontName="Sans", bulletFontSize=9)


def table(data, colw, header=True):
    rows = [[P(c, tcellb if (header and r == 0) else tcell) if isinstance(c, str) else c for c in row] for r, row in enumerate(data)]
    t = Table(rows, colWidths=[c * cm for c in colw], repeatRows=1 if header else 0)
    st = [("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9aa7b8")),
          ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e4ebf4"))]
    t.setStyle(TableStyle(st))
    return t


printers = json.load(open("printers_table.json"))

story = []

# ------------------------------------------------------------------ portada
story += [Spacer(1, 3.0 * cm),
          P(TITLE, ParagraphStyle("t", fontName="Sans-B", fontSize=24, leading=30, textColor=colors.HexColor("#1f3a5f"))),
          Spacer(1, 6),
          P(SUB, ParagraphStyle("s", fontName="Sans", fontSize=13, leading=17, textColor=colors.HexColor("#333333"))),
          Spacer(1, 1.2 * cm),
          P("Procedimiento para medir el desenfoque (σ) y la dosis mínima (D<sub>0</sub>) de un proceso de fotolitografía "
            "hecho con una impresora de resina MSLA Anycubic (Photon Mono 2, Photon Mono 4 Ultra o cualquiera de los modelos "
            "que admite LitoMask), usando el patrón de calibración de la app y un microscopio Nikon Eclipse para las "
            "mediciones. Los ejemplos numéricos están dados para la Mono 2; el apéndice B da los valores de los demás modelos.",
            ParagraphStyle("a", parent=body, fontSize=10.5, leading=15)),
          Spacer(1, 2 * cm),
          P(AUTHOR, ParagraphStyle("au", fontName="Sans", fontSize=10.5, leading=14)),
          P(DATE, ParagraphStyle("da", fontName="Sans", fontSize=9.5, leading=13, textColor=colors.HexColor("#555555"))),
          Spacer(1, 1.6 * cm),
          P("Contenido", h2),
          table([["1", "Qué se calibra y por qué"], ["2", "Material"], ["3", "Montaje del sustrato sobre la pantalla"],
                 ["4", "Generar y exponer el patrón"], ["5", "Revelado e inspección a simple vista"],
                 ["6", "Medición en el Nikon Eclipse"], ["7", "Hoja de registro"], ["8", "Ajuste de σ y D<sub>0</sub> en LitoMask"],
                 ["9", "Comprobaciones y criterios de aceptación"], ["10", "Problemas frecuentes"],
                 ["A", "El modelo que hay detrás"], ["B", "Parámetros del patrón y valores por impresora"]], [0.9, 12], header=False),
          PageBreak()]

# ------------------------------------------------------------------ 1
story += [P("1. Qué se calibra y por qué", h1),
          P("La impresora no es un equipo de litografía: su óptica está pensada para curar resina a 50 µm por capa, no para "
            "reproducir bordes. Aun así, cualquier MSLA funciona sorprendentemente bien como equipo de exposición si se conocen "
            "dos números del proceso completo (pantalla, película protectora, resina, espesor y revelado):"),
          bullets(["<b>σ, el desenfoque.</b> Un píxel encendido no ilumina un cuadrado nítido sino una mancha que se "
                   "difumina hacia los lados. σ es el ancho de esa mancha, en micras. Manda sobre cuánto se redondean las "
                   "esquinas, cuánto se acortan los extremos de línea y a qué separación dos líneas se funden en una.",
                   "<b>D<sub>0</sub>, la dosis mínima.</b> Los segundos de exposición a partir de los cuales la resina reacciona "
                   "lo suficiente como para revelar (en positiva) o quedarse (en negativa). Depende de la resina, del espesor, del "
                   "revelador y de su tiempo, y hasta de la temperatura del cuarto."]),
          P("Con esos dos valores la simulación de LitoMask predice qué va a salir de cada máscara y la corrección por modelo "
            "sabe cuánto material añadir o quitar en cada esquina. Sin ellos la app sigue funcionando, pero a ciegas."),
          P("La calibración se hace <b>una vez por proceso</b>. Hay que repetirla si cambia la resina, el espesor de la capa, "
            "el revelador o la manera de apoyar el sustrato sobre la pantalla. No hace falta repetirla por cambiar de diseño."),
          P("Todo el procedimiento cabe en una sesión: unos 20 minutos de preparación y exposición, el revelado habitual, y "
            "entre 30 y 45 minutos de microscopio.", note)]

# ------------------------------------------------------------------ 2
story += [P("2. Material", h1),
          bullets(["Impresora de resina Anycubic compatible con LitoMask (Photon Mono 2, Mono 4 Ultra o cualquiera de la tabla "
                   "del apéndice B), con la cubeta y la plataforma retiradas y la película protectora del LCD limpia (alcohol "
                   "isopropílico y paño que no suelte pelusa).",
                   "Memoria USB con el archivo del patrón exportado desde LitoMask.",
                   "Sustrato del mismo tipo que se va a usar después (fenólica con cobre, oblea de silicio o vidrio), con la "
                   "fotorresina aplicada y precurada como de costumbre.",
                   "Un peso ligero y plano (una placa de vidrio o un bloque de aluminio de unos 200 g) para mantener el "
                   "contacto entre resina y pantalla.",
                   "Revelador y material de revelado habituales.",
                   "Microscopio Nikon Eclipse con objetivos de 4x o 5x y de 10x o 20x, iluminación reflejada (para silicio y "
                   "fenólica) o transmitida (para vidrio), y una de estas dos opciones para medir: cámara con NIS-Elements o "
                   "retículo ocular graduado. Un micrómetro de platina (portaobjetos con escala de 1 mm en divisiones de 10 µm) "
                   "para calibrar.",
                   "Esta hoja de registro (sección 7) y un bolígrafo."])]

# ------------------------------------------------------------------ 3
story += [P("3. Montaje del sustrato sobre la pantalla", h1),
          fig("fig_montaje.png", 15.5, "Figura 1. Corte del montaje. La resina va en contacto con la película protectora de la pantalla. "
                                       "La luz de cada píxel sale divergente, así que cualquier separación se convierte en desenfoque."),
          P("La regla de oro es <b>contacto</b>. En una impresora normal la resina líquida rellena cualquier hueco; aquí no, y "
            "un aire de 100 µm entre resina y pantalla duplica el desenfoque. Por eso:"),
          numbered(["Limpiar la película protectora y comprobar a contraluz que no tiene rayas ni restos de resina curada. Si "
                    "está muy marcada, cambiarla: es una pieza barata y el desenfoque que produce no se puede corregir después.",
                    "Apoyar el sustrato con la resina hacia abajo, aproximadamente centrado en la pantalla. El patrón ocupa una fila "
                    "de 133 × 13 mm en la Mono 2 y de 65 × 6 mm en la Mono 4 Ultra (los demás modelos, en la tabla del apéndice B) "
                    "y el sustrato debe cubrirlo entero. Si el sustrato es más pequeño, reducir el número de celdas en LitoMask: con "
                    "6 celdas el patrón de la Mono 2 mide 80 mm. En pantallas estrechas la app reparte las celdas en varias filas y en las pequeñas recorta sola las que no caben.",
                    "Poner el peso encima, centrado, sin arrastrar el sustrato para no rayar la película.",
                    "Cubrir el conjunto con una caja o cartón opaco: la resina también reacciona a la luz del cuarto durante los "
                    "minutos que dura la exposición.",
                    "No tocar nada hasta que la impresora indique que terminó. El archivo no mueve el eje Z, así que no hay "
                    "riesgo de que la máquina golpee el montaje."]),
          P("Sobre la orientación: la app muestra la máscara tal como se ve sobre la resina mirándola de frente. Como en la "
            "primera prueba no se sabe si eso se cumple con esta pantalla, el patrón lleva una «F» en cada celda; en la "
            "sección 5 se explica qué ajustar según cómo salga.")]

# ------------------------------------------------------------------ 4
story += [P("4. Generar y exponer el patrón", h1),
          fig("fig_patron.png", 15.5, "Figura 2. El patrón completo generado para la Mono 2 (4096 × 2560 px); en otros modelos cambia la "
                                      "resolución y la app reacomoda las celdas, pero el contenido es el mismo. El archivo tiene diez capas; la "
                                      "celda k aparece en las primeras k capas, así que recibe k veces el tiempo t."),
          P("El truco de la matriz de dosis es que un solo archivo, en una sola pieza, da diez dosis distintas. No hay que "
            "exponer diez sustratos ni cambiar tiempos a mano. Se genera así:"),
          numbered(["Abrir LitoMask (https://romeruu-dev.github.io/litomask/) y elegir en el selector el modelo de impresora que se "
                    "va a calibrar. Debajo del selector aparecen la resolución y el tamaño de píxel; con ellos la app calcula el "
                    "tamaño físico de cada elemento del patrón.",
                    "En <b>1 · Máscara</b> pulsar <b>Patrón de calibración</b>. Dejar 10 celdas y paso de 380 px.",
                    "Elegir el <b>tiempo por capa t</b>. Es la única decisión importante: la celda 10 recibe 10·t y conviene que "
                    "cubra desde «no revela» hasta cuatro o cinco veces la dosis mínima. Si no se tiene idea de D<sub>0</sub>, "
                    "empezar con t = 3 s (dosis de 3 a 30 s). Si en el resultado todas las celdas revelan, repetir con t = 1 s; si "
                    "ninguna, con t = 8 s.",
                    "En <b>5 · Exposición y exportar</b> dejar la pausa en 0 y pulsar <b>Exportar</b>. Se descarga un archivo con nombre "
                    "parecido a <i>calibracion_matriz_dosis_3s_x10.pm3n</i>; la extensión depende del modelo (.pm3n en la Mono 2, "
                    ".pm4u en la Mono 4 Ultra, .pwmx en la Mono X, etc.).",
                    "Copiarlo a la USB, ponerla en la impresora y lanzar el archivo como si fuera una impresión. Con t = 3 s el "
                    "ciclo completo dura poco más de un minuto; la pantalla de la impresora muestra el avance por capas.",
                    "Anotar en la hoja de registro el valor de t, la resina, el espesor y la fecha."]),
          fig("fig_celda.png", 15.5, "Figura 3. Contenido de una celda. Las medidas en micras corresponden a la Mono 2 (35 µm por píxel); "
                                     "en otros modelos el cuadro grande sigue siendo de 100 píxeles, es decir 100 veces el tamaño de píxel. Para el "
                                     "ajuste de σ y D<sub>0</sub> solo se mide el cuadro; el resto sirve para comprobar el resultado.")]

# ------------------------------------------------------------------ 5
story += [P("5. Revelado e inspección a simple vista", h1),
          P("Revelar exactamente como se hará en producción: mismo revelador, misma concentración, mismo tiempo y misma "
            "agitación. La calibración vale para ese revelado y no para otro. Enjuagar, secar y mirar la pieza a contraluz o "
            "con una lupa antes de ir al microscopio; en ese primer vistazo ya se sacan tres conclusiones."),
          P("Qué celdas aparecieron", h2),
          P("En resina positiva las celdas de poca dosis no muestran nada y a partir de cierta celda aparece el patrón, al "
            "principio tímido y después completo. La primera celda que revela acota D<sub>0</sub> por arriba: si aparece la "
            "celda 2 y no la 1, entonces t &lt; D<sub>0</sub> &lt; 2t. En negativa ocurre lo mismo pero al revés (queda resina "
            "donde hubo luz). Si revelaron las diez celdas, la dosis fue excesiva y hay que repetir con un t menor; si no reveló "
            "ninguna, con uno mayor. No merece la pena medir un patrón así."),
          P("Cómo salió la «F»", h2),
          fig("fig_orientacion.png", 15.5, "Figura 4. La «F» dice si la imagen llegó espejada o girada. Se corrige una sola vez en la "
                                           "sección 1 de la app y ya queda para todos los diseños."),
          P("Si la F se lee normal mirando la resina de frente, no hay nada que cambiar. Si sale al revés, activar «Espejo X»; "
            "si cabeza abajo, «Espejo Y»; si girada, «Rotación 180°». Este ajuste es de la máquina, no del diseño, y basta "
            "hacerlo una vez."),
          P("Aspecto general", h2),
          P("Si los bordes de los cuadros se ven ondulados o con manchas en alguna zona de la pantalla y no en otra, casi "
            "siempre es falta de contacto: aire atrapado, polvo o una raya en la película. Hay que repetir la exposición; "
            "no tiene sentido medir un patrón con contacto irregular.")]

# ------------------------------------------------------------------ 6
story += [P("6. Medición en el Nikon Eclipse", h1),
          P("6.1 Preparar el microscopio", h2),
          bullets(["<b>Iluminación.</b> Silicio y fenólica son opacos: iluminación reflejada en campo claro. El vidrio se puede "
                   "ver en transmitida, que da bordes de resina muy contrastados. Ajustar Köhler si el equipo lo permite, y "
                   "cerrar un poco el diafragma de campo para ganar contraste en el borde.",
                   "<b>Objetivo.</b> El cuadro grande mide entre 1.7 y 5 mm según el modelo (3.5 mm en la Mono 2, 1.7 mm en la "
                   "Mono 4 Ultra; tabla del apéndice B). Con un objetivo de 10x y un campo de 22 mm el campo visual es de unos "
                   "2.2 mm: el cuadro de la Mono 4 Ultra cabe, el de la Mono 2 no. Para cuadros grandes usar 4x o 5x, o el método "
                   "de la platina de la sección 6.3. Para las rejillas y las líneas finas usar 10x o 20x.",
                   "<b>Enfoque.</b> Enfocar en la superficie superior de la resina, donde está el borde que interesa. Con la "
                   "resina positiva el borde tiene a veces un halo claro por el escalón; el ancho se mide en el borde de la "
                   "resina, no en el halo.",
                   "<b>Sustrato bien apoyado.</b> Si la pieza no queda plana en la platina, el enfoque cambia de una celda a "
                   "otra y las lecturas del retículo se desplazan. Un portaobjetos con cinta de doble cara resuelve el problema."]),
          P("6.2 Calibrar la escala", h2),
          P("Cualquiera que sea el método de medida, primero hay que saber cuántas micras vale una división. Poner el micrómetro "
            "de platina, enfocarlo con el objetivo que se va a usar y:"),
          bullets(["<b>Con cámara y NIS-Elements:</b> en Calibration → Calibrate using objective, marcar dos rayas del "
                   "micrómetro separadas una distancia conocida (por ejemplo 1000 µm) y aceptar. El programa guarda la "
                   "calibración por objetivo; hay que hacerla para cada objetivo que se use y comprobarla si alguien cambió el "
                   "acoplador de la cámara.",
                   "<b>Con retículo ocular:</b> alinear la escala del retículo con la del micrómetro y contar cuántas divisiones "
                   "del retículo caben en un tramo conocido del micrómetro. Micras por división = tramo (µm) / divisiones del "
                   "retículo. Apuntar el valor por objetivo en la hoja de registro. Valores típicos con retículo de 100 "
                   "divisiones en 10 mm: unos 25 µm/div a 4x, 10 µm/div a 10x y 5 µm/div a 20x, pero cada microscopio da lo suyo."]),
          P("6.3 Medir el cuadro grande", h2),
          fig("fig_microscopio.png", 15.0, "Figura 5. Dos maneras de medir el cuadro. A la izquierda, tres lecturas borde a borde en una "
                                           "misma imagen a bajo aumento. A la derecha, el método de la platina: retículo en cruz sobre "
                                           "un borde, leer X, mover hasta el otro borde, leer X de nuevo."),
          P("Hay dos maneras y ambas sirven; lo importante es usar siempre la misma y el mismo criterio de borde en las diez "
            "celdas."),
          bullets(["<b>Método A, en la imagen.</b> Con el objetivo de 4x o 5x (2x si el cuadro pasa de 5 mm; 10x en la Mono 4 Ultra), "
                   "encuadrar el cuadro entero y medir su ancho de borde a borde con la herramienta de longitud de NIS-Elements "
                   "(o con el retículo, contando divisiones y multiplicando por la calibración). Hacer tres lecturas a distintas "
                   "alturas, arriba, centro y abajo, y anotar las tres.",
                   "<b>Método B, con la platina.</b> Sirve para cualquier tamaño y con platina de lectura digital es el más "
                   "preciso. Con 10x, poner la cruz del retículo justo sobre el borde izquierdo del cuadro y leer la posición X "
                   "de la platina; mover hasta el borde derecho, volver a leer; el ancho es la diferencia. Repetir a tres alturas. "
                   "Mover siempre en el mismo sentido para no arrastrar el juego del husillo."]),
          P("El borde de la resina se toma donde el tono cambia de forma neta, no en el centro del halo. Si a alguien le "
            "cuesta decidir, fijarse en el borde superior (el más lejano) del escalón en las cuatro caras del cuadro y ser "
            "coherente. Un sesgo constante no afecta a σ y solo desplaza ligeramente D<sub>0</sub>; un criterio que cambia "
            "de celda a celda sí estropea el ajuste.", note),
          P("6.4 Anotar hasta dónde resuelve", h2),
          P("Con 10x o 20x, mirar en cada celda las rejillas verticales y las horizontales y anotar el paso más fino en el "
            "que las líneas se ven separadas de forma limpia en toda su longitud (no basta con que se adivinen). Anotar también "
            "la línea aislada más estrecha que sobrevivió al revelado. Estos datos no entran en el ajuste, pero son la "
            "comprobación independiente de la sección 9 y describen la resolución práctica del proceso."),
          P("Si se dispone de cámara, tomar una foto de la celda cuya dosis quede más cerca de 2·D<sub>0</sub> con el cuadrado "
            "con serifs, el cuadrado sin serifs y los dos extremos de línea: es la imagen que después se compara con la "
            "simulación de la app.")]

# ------------------------------------------------------------------ 7 hoja de registro
rows = [["Celda", "Dosis (s)<br/>k · t", "Ancho arriba<br/>(µm)", "Ancho centro<br/>(µm)", "Ancho abajo<br/>(µm)", "Promedio<br/>(µm)",
         "Rejilla V<br/>más fina (px)", "Rejilla H<br/>más fina (px)", "Observaciones"]]
for k in range(1, 11):
    rows.append([str(k), f"{k} · t =", "", "", "", "", "", "", ""])
# Usable frame width is 17.17 cm (17.59 minus the 6 pt frame padding on each side); keep both tables under it
reg = table(rows, [1.4, 1.6, 1.7, 1.7, 1.7, 1.95, 1.7, 1.7, 3.4])
reg.setStyle(TableStyle([("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f6f8fb")]),
                         ("TOPPADDING", (0, 1), (-1, -1), 9), ("BOTTOMPADDING", (0, 1), (-1, -1), 9)]))
meta = table([["Fecha", "", "Resina y espesor", ""],
              ["Tiempo por capa t (s)", "", "Revelador y tiempo", ""],
              ["Impresora y sustrato", "", "Objetivo y calibración<br/>(µm/div)", ""],
              ["Orientación de la F", "", "Método de medida (A / B)", ""]], [3.4, 4.3, 4.6, 4.7], header=False)
meta.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                          ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#e4ebf4")), ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#e4ebf4"))]))
story += [PageBreak(), P("7. Hoja de registro", h1),
          P("Rellenar a mano en el microscopio y después pasar la columna «Promedio» a la app. Dejar en blanco las celdas que "
            "no revelaron; no escribir cero."),
          meta, Spacer(1, 10), reg, Spacer(1, 8),
          P("El promedio de tres lecturas se hace para quitar el error de apreciación del borde, que suele ser de una o dos "
            "divisiones. Si una de las tres lecturas se aparta más de 30 µm de las otras dos, repetirla.", small)]

# ------------------------------------------------------------------ 8
story += [P("8. Ajuste de σ y D<sub>0</sub> en LitoMask", h1),
          numbered(["Con el patrón de calibración generado en la app, la misma impresora y el mismo valor de t, abrir <b>4 · "
                    "Simulación y calibración</b> y pulsar <b>Ajustar σ y D<sub>0</sub> con mediciones</b>.",
                    "Comprobar el ancho nominal: la app lo rellena con 100 píxeles de la impresora seleccionada (3500 µm en la Mono 2, "
                    "1700 en la Mono 4 Ultra, 5000 en la Mono X; tabla del apéndice B). Si se midió la línea de 8 px en lugar del cuadro, "
                    "poner 8 veces el tamaño de píxel (280 µm en la Mono 2).",
                    "Escribir el promedio de cada celda en micras. Las celdas que no revelaron se dejan vacías.",
                    "En cuanto hay tres celdas con dato la app calcula y muestra σ en micras y en píxeles, D<sub>0</sub> en "
                    "segundos, el error cuadrático medio (RMS) del ajuste y, en la última columna, el ancho que predice el "
                    "modelo para cada celda.",
                    "Si el resultado es razonable (sección 9), pulsar <b>Usar σ y D<sub>0</sub> en la simulación</b>. Los valores "
                    "quedan cargados en la sección 4 y a partir de ahí los usan la simulación y la corrección por modelo."]),
          P("Anotar σ y D<sub>0</sub> en la hoja de registro junto con la resina y el revelado. La app no los guarda entre "
            "sesiones; conviene tener una tabla en el laboratorio con los valores por proceso.", note)]

# ------------------------------------------------------------------ 9
story += [P("9. Comprobaciones y criterios de aceptación", h1),
          table([["Qué mirar", "Esperable", "Si no se cumple"],
                 ["σ", "Entre 1 y 2 píxeles de la impresora (35 a 70 µm en la Mono 2) con buen contacto", "Más de 3 píxeles: aire, película rayada o resina gruesa. Revisar el montaje y repetir."],
                 ["D<sub>0</sub>", "Entre la última celda que no reveló y la primera que sí", "Si cae fuera de ese intervalo el ajuste no describe los datos: revisar las lecturas."],
                 ["RMS", "Menor de 10 a 15 µm", "Un RMS grande suele ser una celda mal leída: comparar la columna «Ancho según ajuste» con las mediciones y localizarla."],
                 ["Rejilla más fina resuelta", "Entre 4σ y 5σ, en píxeles", "Si resuelve mucho menos de lo que σ predice, la resina o el revelado limitan, no la óptica."],
                 ["Cuadrado con serifs", "Esquinas visiblemente más cuadradas que su vecino", "Si no se nota diferencia, el serif de 2 px es pequeño para este σ: probar 3 px."],
                 ["Vertical frente a horizontal", "Misma rejilla resuelta en ambas", "Si difieren, hay un desplazamiento del sustrato durante la exposición o vibración."]],
                [3.4, 5.3, 7.6]),
          Spacer(1, 6),
          P("Un caso que engaña: si D<sub>0</sub> sale muy bajo y σ muy alto a la vez, casi siempre es que se midió el halo "
            "y no el borde. Volver al microscopio con la celda central, decidir el criterio de borde y repetir las tres "
            "lecturas de todas las celdas con ese criterio.")]

# ------------------------------------------------------------------ 10
story += [P("10. Problemas frecuentes", h1),
          table([["Síntoma", "Causa probable", "Qué hacer"],
                 ["Todas las celdas revelaron, incluso la 1", "t demasiado grande", "Repetir con t entre 3 y 5 veces menor"],
                 ["Ninguna celda reveló", "t demasiado pequeño, o resina sin precurar bien", "Repetir con t 3 veces mayor; revisar el precurado"],
                 ["Bordes ondulados solo en una zona", "Falta de contacto local: polvo, aire, raya en la película", "Limpiar, repetir; cambiar la película si tiene marcas"],
                 ["El patrón salió borroso en toda la pieza", "Resina muy gruesa o sustrato alabeado", "Reducir espesor; usar un peso mayor y más plano"],
                 ["La F sale invertida", "Es normal, depende de cómo la pantalla mapea la imagen", "Ajustar espejo o rotación en la sección 1 y dejarlo fijo"],
                 ["Rejillas finas resueltas en vertical pero no en horizontal", "Movimiento del sustrato durante la exposición", "Fijar mejor el peso; no apoyarse en la impresora"],
                 ["Las lecturas del cuadro varían más de 50 µm entre alturas", "Criterio de borde cambiante o pieza no plana en la platina", "Fijar la pieza; releer con el mismo criterio"],
                 ["La impresora no ve el archivo o lo marca como corrupto", "Extensión o nombre con caracteres raros; archivo de otro modelo", "Renombrar a algo corto sin acentos; comprobar el modelo elegido en la app"]],
                [4.6, 5.6, 6.1])]

# ------------------------------------------------------------------ A
story += [PageBreak(), P("Apéndice A. El modelo que hay detrás", h1),
          P("No hace falta entender esto para calibrar, pero ayuda a interpretar los números. La luz que llega a cada punto "
            "de la resina es la suma de lo que aportan todos los píxeles encendidos a su alrededor, cada uno con una "
            "distribución gaussiana de anchura σ. Si se normaliza a 1 en el interior de una zona grande expuesta, un borde "
            "recto recibe 0.5, una esquina convexa 0.25 y una cóncava 0.75."),
          fig("fig_desenfoque.png", 15.5, "Figura 6. Dosis relativa alrededor de un cuadrado expuesto. La resina revela donde la dosis "
                                          "supera D<sub>0</sub>, es decir donde I ≥ D<sub>0</sub>/D."),
          P("Con dosis D, la resina revela donde D·I(x) ≥ D<sub>0</sub>. Para un cuadro de ancho nominal w<sub>0</sub> mucho "
            "mayor que σ, el borde impreso se desplaza hacia fuera cuando D crece, y el ancho medido resulta:"),
          P("w(D) = w<sub>0</sub> + 2·σ·√2 · erf<super>−1</super>(1 − 2·D<sub>0</sub>/D)", eq),
          P("La curva arranca en D = D<sub>0</sub> (justo por encima el cuadro sale del orden de 3σ a 4σ más estrecho que "
            "w<sub>0</sub>, y por debajo no aparece), cruza w<sub>0</sub> en D = 2·D<sub>0</sub> y sigue creciendo despacio. La pendiente de la "
            "subida depende solo de σ; el punto de arranque, solo de D<sub>0</sub>. Por eso con diez celdas bien repartidas "
            "los dos parámetros quedan determinados de forma independiente."),
          fig("fig_curva.png", 15.5, "Figura 7. Ancho impreso contra dosis. Dos desenfoques distintos dan pendientes distintas; "
                                     "dos dosis mínimas distintas desplazan el arranque. Los puntos son mediciones de ejemplo."),
          P("La app busca la pareja (σ, D<sub>0</sub>) que mejor reproduce los anchos medidos: para cada D<sub>0</sub> de "
            "prueba el ajuste de σ es lineal y tiene solución cerrada, y D<sub>0</sub> se busca por barrido con refinamiento. "
            "El RMS es la desviación típica entre los anchos medidos y los que predice la curva ajustada."),
          P("El punto de trabajo normal es D ≈ 2·D<sub>0</sub>: el borde recto cae justo donde el diseño lo pone. A esa dosis "
            "las esquinas convexas (0.25) quedan sin revelar y las cóncavas (0.75) reveladas de más; de ahí el redondeo, y de "
            "ahí los serifs de la corrección de proximidad.")]

# ------------------------------------------------------------------ B
story += [P("Apéndice B. Parámetros del patrón y valores por impresora", h1),
          P("B.1 Contenido de una celda", h2),
          table([["Elemento", "Valor por defecto (píxeles)", "En micras (Mono 2, 35 µm/px)"],
                 ["Celdas", "10, en una fila (en varias si la pantalla es estrecha)", "paso 380 px = 13.3 mm"],
                 ["Cuadro grande", "100 × 100 px", "3500 µm"],
                 ["Líneas aisladas", "1, 2, 3, 4, 6, 8 px de ancho; 100 px de largo", "35 a 280 µm"],
                 ["Rejillas", "paso 2, 3, 4, 6, 8, 12, 16 px; línea = espacio", "70 a 560 µm de paso"],
                 ["Cuadrados de serifs", "30 px, serif de 2 px", "1050 µm, serif de 70 µm"],
                 ["Extremos de línea", "4 px de ancho, 40 de largo; hammerhead de 2 px", "140 × 1400 µm"],
                 ["Pares de líneas", "4 px con huecos de 1, 2, 3 y 4 px", "huecos de 35 a 140 µm"],
                 ["Dosis por celda", "k · t, con t elegido en la app", "—"]],
                [4.0, 6.6, 5.7]),
          Spacer(1, 8),
          P("Todos estos valores se pueden cambiar en el código de la app (archivo src/core/testpattern.ts) si algún día "
            "hace falta un patrón distinto, por ejemplo con más celdas y menos paso para acotar mejor D<sub>0</sub>.", small),
          P("B.2 Valores del patrón según la impresora", h2),
          P("El patrón se define en píxeles, así que su tamaño físico cambia con la impresora. La tabla da, para cada modelo "
            "que admite LitoMask, el tamaño de píxel, el ancho nominal del cuadro grande que hay que escribir en el diálogo de "
            "ajuste (la app lo pone sola), cuántas celdas de las diez caben en la pantalla y cuánto mide el patrón completo. "
            "En los modelos de pantalla pequeña (Ultra, Zero) caben pocas celdas; conviene subir el paso de dosis, por "
            "ejemplo t = 6 s, o hacer dos exposiciones con t distinto. En los de píxel fino (Mono 4 Ultra) el patrón queda "
            "pequeño y se mide cómodamente a 10x."),
          table([["Modelo", "Archivo", "Resolución (px)", "Píxel (µm)", "Cuadro grande (µm)", "Celdas que caben", "Patrón (mm)"]] +
                [list(r) for r in printers],
                [4.3, 1.5, 2.4, 1.6, 2.2, 1.9, 2.4]),
          Spacer(1, 6),
          P("Todo lo demás (montaje, tiempos, medición, ajuste y criterios) es idéntico de un modelo a otro. Lo que sí cambia "
            "de una máquina a otra, aunque sea del mismo modelo, es el resultado: σ y D<sub>0</sub> son de cada impresora con su "
            "resina, y hay que medirlos en cada una. Esta tabla se genera desde la lista de impresoras de la app, así que "
            "cualquier modelo nuevo aparece aquí al regenerar la guía.", small)]

# Keep every heading with the flowable that follows it (no orphan headings at page bottom).
# Consecutive headings (h1 followed by its first h2) travel together with the first real block,
# and a following KeepTogether (a figure with its caption) is flattened into the group: a nested
# KeepTogether reports a fake height of 0xffffff to its parent, which would force a page break
# before every figure that follows a heading.
def is_heading(f):
    return isinstance(f, Paragraph) and f.style.name in ("h1", "h2")


merged = []
i = 0
while i < len(story):
    item = story[i]
    if is_heading(item):
        group = [item]
        i += 1
        while i < len(story) and is_heading(story[i]):
            group.append(story[i])
            i += 1
        if i < len(story):
            nxt = story[i]
            group += list(nxt._content) if isinstance(nxt, KeepTogether) else [nxt]
            i += 1
        merged.append(KeepTogether(group))
    else:
        merged.append(item)
        i += 1
story = merged

doc = BaseDocTemplate(OUT, pagesize=letter, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2.1 * cm, bottomMargin=2 * cm,
                      title=TITLE, author=AUTHOR, subject=SUB, creator="LitoMask")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=header_footer)])
doc.build(story)
print("ok", OUT)
