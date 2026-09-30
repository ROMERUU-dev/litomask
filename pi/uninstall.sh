#!/usr/bin/env bash
# Desinstalador del puente USB de LitoMask.
#
#   sudo ./uninstall.sh [--purge] [--keep-boot] [--yes]
#
#   --purge      borra también la imagen USB (/var/lib/litomask) y su contenido
#   --keep-boot  no quita dwc2 de config.txt / cmdline.txt
#   --yes        no pregunta
#
# El nombre de host no se revierte: usa "sudo hostnamectl set-hostname NUEVO" si hace falta.
set -euo pipefail

UNIT=litomask-usb.service
OPT_DIR=/opt/litomask
DATA_DIR=/var/lib/litomask
PURGE=no
KEEP_BOOT=no
ASSUME_YES=no

info() { printf '==> %s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --purge) PURGE=yes; shift ;;
        --keep-boot) KEEP_BOOT=yes; shift ;;
        --yes|-y) ASSUME_YES=yes; shift ;;
        -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "opción desconocida: $1" ;;
    esac
done
[ "$(id -u)" -eq 0 ] || die "ejecuta con sudo: sudo $0"

if [ "$ASSUME_YES" = no ] && [ -t 0 ]; then
    echo "Se va a quitar el servicio $UNIT y $OPT_DIR."
    [ "$PURGE" = yes ] && echo "También se BORRARÁ la imagen USB $DATA_DIR/usb.img con todos sus archivos."
    read -r -p "¿Continuar? [s/N] " ans
    case "$ans" in s|S|si|sí|Si|Sí|y|Y) ;; *) echo "cancelado"; exit 0 ;; esac
fi

info "Parando el servicio"
systemctl disable --now "$UNIT" 2>/dev/null || true
rm -f "/etc/systemd/system/$UNIT"
systemctl daemon-reload
ok "servicio eliminado"

info "Retirando la memoria USB emulada"
modprobe -r g_mass_storage 2>/dev/null || true
umount "$DATA_DIR/mnt" 2>/dev/null || true
ok "g_mass_storage descargado"

info "Borrando archivos"
rm -rf "$OPT_DIR"
rm -f /etc/default/litomask-usb
ok "$OPT_DIR eliminado"
if [ "$PURGE" = yes ]; then
    rm -rf "$DATA_DIR"
    ok "$DATA_DIR eliminado (imagen incluida)"
else
    ok "se conserva $DATA_DIR/usb.img (usa --purge para borrarlo)"
fi

if [ "$KEEP_BOOT" = no ]; then
    info "Quitando dwc2 de la configuración de arranque"
    CONFIG=/boot/firmware/config.txt; [ -f "$CONFIG" ] || CONFIG=/boot/config.txt
    CMDLINE=/boot/firmware/cmdline.txt; [ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
    if [ -f "$CONFIG" ]; then
        # Solo el bloque que añadió install.sh (comentario marcador + línea siguiente).
        sed -i '/^# LitoMask: USB en modo periférico/,+1d' "$CONFIG"
        ok "$CONFIG limpio"
    fi
    if [ -f "$CMDLINE" ]; then
        sed -i -E 's/(^|[[:space:]])modules-load=dwc2([[:space:]]|$)/\2/; s/(modules-load=[^[:space:]]*),dwc2/\1/; s/modules-load=dwc2,/modules-load=/' "$CMDLINE"
        ok "$CMDLINE limpio"
    fi
    echo "  (los cambios de arranque se aplican al reiniciar)"
fi

echo
info "Desinstalación terminada"
