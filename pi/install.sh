#!/usr/bin/env bash
# Instalador del puente USB de LitoMask para Raspberry Pi OS (Bookworm o posterior).
#
#   sudo ./install.sh [--size 4G] [--hostname | --no-hostname] [--dist litomask-dist.zip]
#                     [--no-download] [--recreate-image] [--yes]
#
# Qué hace (todo idempotente: se puede volver a ejecutar para actualizar):
#   1. instala las dependencias mínimas (python3, dosfstools, unzip, curl, avahi)
#   2. activa el controlador USB en modo periférico (dwc2) en config.txt y cmdline.txt
#   3. crea la imagen FAT32 que la impresora verá como memoria USB
#   4. copia el servidor a /opt/litomask y la unidad systemd
#   5. descarga la app estática de LitoMask a /opt/litomask/www (opcional)
#   6. habilita el servicio litomask-usb
#   7. fija el nombre de host a "litomask" (opcional) -> http://litomask.local:8080
set -euo pipefail

DIST_URL="https://github.com/ROMERUU-dev/litomask/releases/latest/download/litomask-dist.zip"
OPT_DIR=/opt/litomask
DATA_DIR=/var/lib/litomask
IMAGE="$DATA_DIR/usb.img"
MOUNT_DIR="$DATA_DIR/mnt"
UNIT=litomask-usb.service
LABEL=LITOMASK

SIZE=4G
HOSTNAME_MODE=ask     # ask | yes | no
DOWNLOAD=yes
DIST_ZIP=""
RECREATE=no
ASSUME_YES=no
NEED_REBOOT=no

# ---- utilidades ---------------------------------------------------------------

if [ -t 1 ]; then
    C_INFO=$'\e[1;34m'; C_OK=$'\e[1;32m'; C_WARN=$'\e[1;33m'; C_ERR=$'\e[1;31m'; C_END=$'\e[0m'
else
    C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_END=""
fi
info() { printf '%s==>%s %s\n' "$C_INFO" "$C_END" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$C_OK" "$C_END" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_WARN" "$C_END" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$C_ERR" "$C_END" "$*" >&2; exit 1; }

usage() {
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    cat <<'EOF'

Opciones:
  --size TAMAÑO      tamaño de la memoria USB emulada al crearla (4G). Máximo
                     recomendado 32G; mínimo 64M. Solo se usa al crear la imagen.
  --hostname         fija el nombre de host a "litomask" sin preguntar
  --no-hostname      no toca el nombre de host
  --dist ARCHIVO     usa este litomask-dist.zip en vez de descargarlo
  --no-download      no descarga la app (solo API); se puede añadir después
  --recreate-image   borra la imagen existente y crea una nueva (SE PIERDE su contenido)
  --yes              no hace preguntas (asume "sí")
  -h, --help         esta ayuda
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --size) SIZE="${2:?falta el tamaño}"; shift 2 ;;
        --size=*) SIZE="${1#*=}"; shift ;;
        --hostname) HOSTNAME_MODE=yes; shift ;;
        --no-hostname) HOSTNAME_MODE=no; shift ;;
        --dist) DIST_ZIP="${2:?falta el archivo}"; shift 2 ;;
        --dist=*) DIST_ZIP="${1#*=}"; shift ;;
        --no-download) DOWNLOAD=no; shift ;;
        --recreate-image) RECREATE=yes; shift ;;
        --yes|-y) ASSUME_YES=yes; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "opción desconocida: $1 (usa --help)" ;;
    esac
done

[ "$(id -u)" -eq 0 ] || die "ejecuta este instalador con sudo: sudo $0"

SRC_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
for f in litomask-usb.py litomask-usb.service; do
    [ -f "$SRC_DIR/$f" ] || die "no encuentro $SRC_DIR/$f; ejecuta el instalador desde la carpeta pi/ del repositorio"
done

confirm() {
    # confirm "pregunta" -> 0 si sí. Sin terminal o con --yes responde que sí.
    if [ "$ASSUME_YES" = yes ] || [ ! -t 0 ]; then return 0; fi
    local ans
    read -r -p "$1 [S/n] " ans
    case "${ans:-s}" in s|S|si|sí|Si|Sí|y|Y) return 0 ;; *) return 1 ;; esac
}

# ---- 0. comprobaciones previas -------------------------------------------------

info "Comprobando el equipo"
MODEL=""
[ -r /proc/device-tree/model ] && MODEL="$(tr -d '\0' < /proc/device-tree/model)"
if [ -z "$MODEL" ]; then
    warn "esto no parece una Raspberry Pi (/proc/device-tree/model no existe); sigo, pero el modo gadget puede no funcionar"
else
    ok "modelo: $MODEL"
    case "$MODEL" in
        *"Pi 3"*|*"Pi 2"*|*"Compute Module 3"*|*"Raspberry Pi Model B"*)
            warn "este modelo NO admite el modo periférico USB (su puerto siempre es host). Sirve una Pi Zero / Zero 2 W, Pi 4, Pi 5 o Pi 400." ;;
    esac
fi
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${VERSION_CODENAME:-}" in
        bookworm|trixie|forky) ok "sistema: ${PRETTY_NAME:-$VERSION_CODENAME}" ;;
        *) warn "sistema ${PRETTY_NAME:-desconocido}: probado solo en Raspberry Pi OS Bookworm o posterior" ;;
    esac
fi
PY_OK=$(python3 -c 'import sys; print(int(sys.version_info >= (3, 11)))' 2>/dev/null || echo 0)
[ "$PY_OK" = 1 ] || warn "se necesita Python 3.11 o superior; se intentará instalar python3"

# ---- 1. dependencias -----------------------------------------------------------

info "Dependencias"
MISSING=()
command -v python3   >/dev/null || MISSING+=(python3)
command -v mkfs.vfat >/dev/null || MISSING+=(dosfstools)
command -v unzip     >/dev/null || MISSING+=(unzip)
command -v curl      >/dev/null || MISSING+=(curl ca-certificates)
command -v fallocate >/dev/null || MISSING+=(util-linux)
command -v avahi-daemon >/dev/null || [ -x /usr/sbin/avahi-daemon ] || MISSING+=(avahi-daemon)
if [ ${#MISSING[@]} -gt 0 ]; then
    info "Instalando: ${MISSING[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || warn "apt-get update falló (¿sin internet?); intento instalar con la caché"
    apt-get install -y -qq --no-install-recommends "${MISSING[@]}" || die "no se pudieron instalar las dependencias"
fi
ok "python3, dosfstools, unzip, curl y avahi disponibles"

# ---- 2. dwc2 en modo periférico ------------------------------------------------

info "Controlador USB en modo periférico (dwc2)"
CONFIG=/boot/firmware/config.txt
[ -f "$CONFIG" ] || CONFIG=/boot/config.txt
CMDLINE=/boot/firmware/cmdline.txt
[ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
[ -f "$CONFIG" ] && [ -f "$CMDLINE" ] || die "no encuentro config.txt/cmdline.txt en /boot/firmware ni en /boot"

if grep -qE '^[[:space:]]*dtoverlay=dwc2,dr_mode=peripheral[[:space:]]*$' "$CONFIG"; then
    ok "$CONFIG ya tiene dtoverlay=dwc2,dr_mode=peripheral"
else
    if grep -qE '^[[:space:]]*dtoverlay=dwc2' "$CONFIG"; then
        warn "$CONFIG ya contiene otra línea dtoverlay=dwc2 (¿modo host?). Revisa que no entre en conflicto:"
        grep -nE '^[[:space:]]*dtoverlay=dwc2' "$CONFIG" >&2 || true
    fi
    [ -f "$CONFIG.litomask.bak" ] || cp -a "$CONFIG" "$CONFIG.litomask.bak"
    printf '\n[all]\n# LitoMask: USB en modo periférico (memoria USB emulada)\ndtoverlay=dwc2,dr_mode=peripheral\n' >> "$CONFIG"
    ok "añadido dtoverlay=dwc2,dr_mode=peripheral a $CONFIG (copia en $CONFIG.litomask.bak)"
    NEED_REBOOT=yes
fi
if grep -qE '^[[:space:]]*otg_mode=1' "$CONFIG"; then
    warn "$CONFIG tiene otg_mode=1. Si está fuera de una sección [cm4]/[cm5] anula el modo periférico: coméntala."
fi

if tr ' ' '\n' < "$CMDLINE" | grep -qE '^modules-load=([^,]+,)*dwc2(,|$)'; then
    ok "$CMDLINE ya carga dwc2"
else
    [ -f "$CMDLINE.litomask.bak" ] || cp -a "$CMDLINE" "$CMDLINE.litomask.bak"
    if grep -qE '(^|[[:space:]])modules-load=' "$CMDLINE"; then
        sed -i -E 's/(^|[[:space:]])modules-load=([^[:space:]]*)/\1modules-load=\2,dwc2/' "$CMDLINE"
    else
        sed -i -E '1 s/[[:space:]]*$/ modules-load=dwc2/' "$CMDLINE"
    fi
    ok "añadido modules-load=dwc2 a $CMDLINE (copia en $CMDLINE.litomask.bak)"
    NEED_REBOOT=yes
fi

# ---- 3. imagen FAT32 -----------------------------------------------------------

info "Memoria USB emulada ($IMAGE)"
install -d -m 755 "$DATA_DIR" "$MOUNT_DIR"
if [ -f "$IMAGE" ] && [ "$RECREATE" = no ]; then
    ok "la imagen ya existe ($(du -h "$IMAGE" | cut -f1)); se conserva. Usa --recreate-image para crearla de nuevo"
else
    if [ -f "$IMAGE" ]; then
        confirm "Se va a BORRAR la imagen actual y todo su contenido. ¿Continuar?" || die "cancelado"
        systemctl stop "$UNIT" 2>/dev/null || true
        modprobe -r g_mass_storage 2>/dev/null || true
        umount "$MOUNT_DIR" 2>/dev/null || true
        rm -f "$IMAGE"
    fi
    BYTES=$(numfmt --from=iec "$SIZE" 2>/dev/null) || die "tamaño no válido: $SIZE (ejemplos: 512M, 4G, 16G)"
    [ "$BYTES" -ge $((64 * 1024 * 1024)) ] || die "el tamaño mínimo para FAT32 es 64M"
    [ "$BYTES" -le $((32 * 1024 * 1024 * 1024)) ] || warn "más de 32G: algunas impresoras no leen volúmenes FAT32 tan grandes"
    AVAIL=$(df --output=avail -B1 "$DATA_DIR" | tail -n 1)
    [ "$BYTES" -lt "$AVAIL" ] || die "no hay espacio en la tarjeta SD para una imagen de $SIZE (libre: $(numfmt --to=iec "$AVAIL"))"
    info "Creando imagen de $SIZE (fallocate + mkfs.vfat -F 32 -n $LABEL)"
    rm -f "$IMAGE.tmp"
    fallocate -l "$BYTES" "$IMAGE.tmp" || die "fallocate falló"
    mkfs.vfat -F 32 -n "$LABEL" "$IMAGE.tmp" >/dev/null || die "mkfs.vfat falló"
    mv "$IMAGE.tmp" "$IMAGE"
    chmod 600 "$IMAGE"
    ok "imagen creada"
fi

# ---- 4. servidor y unidad systemd ------------------------------------------------

info "Servidor en $OPT_DIR"
install -d -m 755 "$OPT_DIR"
install -m 755 "$SRC_DIR/litomask-usb.py" "$OPT_DIR/litomask-usb.py"
install -m 644 "$SRC_DIR/litomask-usb.service" "/etc/systemd/system/$UNIT"
if [ ! -f /etc/default/litomask-usb ]; then
    cat > /etc/default/litomask-usb <<'EOF'
# Opciones adicionales para litomask-usb.py (ver: python3 /opt/litomask/litomask-usb.py --help).
# Ejemplo: LITOMASK_OPTS="--mount-options loop --verbose"
LITOMASK_OPTS=
EOF
fi
ok "litomask-usb.py y $UNIT instalados"

# ---- 5. app estática ------------------------------------------------------------

info "Aplicación web LitoMask ($OPT_DIR/www)"
ZIP=""
TMP_ZIP=""
if [ -n "$DIST_ZIP" ]; then
    [ -f "$DIST_ZIP" ] || die "no existe $DIST_ZIP"
    ZIP="$DIST_ZIP"
elif [ "$DOWNLOAD" = yes ]; then
    TMP_ZIP="$(mktemp --suffix=.zip)"
    if curl -fsSL --retry 3 --connect-timeout 15 -o "$TMP_ZIP" "$DIST_URL"; then
        ZIP="$TMP_ZIP"
    else
        warn "no se pudo descargar $DIST_URL"
        warn "sigo sin la app: la API funcionará igual. Para añadirla después: sudo $0 --dist litomask-dist.zip"
    fi
else
    ok "descarga omitida (--no-download)"
fi
if [ -n "$ZIP" ]; then
    rm -rf "$OPT_DIR/www.new"
    mkdir -p "$OPT_DIR/www.new"
    if unzip -q -o "$ZIP" -d "$OPT_DIR/www.new" && [ -f "$OPT_DIR/www.new/index.html" ]; then
        rm -rf "$OPT_DIR/www"
        mv "$OPT_DIR/www.new" "$OPT_DIR/www"
        ok "app instalada en $OPT_DIR/www"
    else
        rm -rf "$OPT_DIR/www.new"
        warn "el zip no contiene un index.html válido; se conserva la app anterior si la había"
    fi
fi
[ -n "$TMP_ZIP" ] && rm -f "$TMP_ZIP"
[ -f "$OPT_DIR/www/index.html" ] || warn "sin app estática: http://litomask.local:8080/ mostrará solo un aviso (la API sí funciona)"

# ---- 6. servicio ----------------------------------------------------------------

info "Servicio systemd"
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1 || die "systemctl enable $UNIT falló; revisa: systemctl status $UNIT"
if [ -n "$(ls -A /sys/class/udc 2>/dev/null)" ]; then
    systemctl restart "$UNIT"
    sleep 1
    if systemctl is-active --quiet "$UNIT"; then
        ok "servicio $UNIT activo (modo gadget)"
    else
        warn "el servicio no arrancó; revisa: journalctl -u $UNIT -n 50"
    fi
else
    ok "servicio $UNIT habilitado; arrancará tras reiniciar (dwc2 todavía no está activo)"
    NEED_REBOOT=yes
fi

# ---- 7. nombre de host ----------------------------------------------------------

info "Nombre de host"
CURRENT_HOST="$(hostname)"
SET_HOST=no
case "$HOSTNAME_MODE" in
    yes) SET_HOST=yes ;;
    no)  ok "se conserva el nombre '$CURRENT_HOST' (--no-hostname)" ;;
    ask)
        if [ "$CURRENT_HOST" = litomask ]; then
            ok "el nombre de host ya es 'litomask'"
        elif confirm "¿Fijar el nombre de host a 'litomask' para usar http://litomask.local:8080? (ahora es '$CURRENT_HOST')"; then
            SET_HOST=yes
        else
            ok "se conserva '$CURRENT_HOST'; la app estará en http://$CURRENT_HOST.local:8080"
        fi ;;
esac
if [ "$SET_HOST" = yes ] && [ "$CURRENT_HOST" != litomask ]; then
    if command -v hostnamectl >/dev/null; then
        hostnamectl set-hostname litomask 2>/dev/null || echo litomask > /etc/hostname
    else
        echo litomask > /etc/hostname
    fi
    if grep -qE '^127\.0\.1\.1[[:space:]]' /etc/hosts; then
        sed -i -E 's/^(127\.0\.1\.1[[:space:]]+).*/\1litomask/' /etc/hosts
    else
        printf '127.0.1.1\tlitomask\n' >> /etc/hosts
    fi
    ok "nombre de host fijado a 'litomask' (efectivo tras reiniciar)"
    NEED_REBOOT=yes
fi

# ---- resumen ----------------------------------------------------------------------

HOST_FOR_URL=litomask
[ "$SET_HOST" = yes ] || HOST_FOR_URL="$CURRENT_HOST"
echo
info "Instalación terminada"
cat <<EOF
  App y API:      http://$HOST_FOR_URL.local:8080/   (también por IP: http://$(hostname -I 2>/dev/null | awk '{print $1}'):8080/)
  Estado:         curl http://$HOST_FOR_URL.local:8080/api/status
  Registro:       journalctl -u $UNIT -f
  Imagen USB:     $IMAGE
  Cable:          Pi (puerto USB de datos) -> puerto USB de la impresora
EOF
if [ "$NEED_REBOOT" = yes ]; then
    echo
    warn "Hace falta REINICIAR para activar el modo periférico USB y el nombre de host:  sudo reboot"
fi
