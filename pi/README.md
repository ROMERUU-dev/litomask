# Puente USB con Raspberry Pi

Las impresoras Anycubic de resina (Photon Mono 2, Mono 4 Ultra, etc.) solo leen memorias
USB: no tienen API local ni aceptan archivos por red. Este puente convierte una Raspberry Pi
en una **memoria USB emulada**: la Pi se enchufa al puerto USB de la impresora y se presenta
como un pendrive FAT32 llamado `LITOMASK`; la computadora le manda el archivo de exposición por
Wi-Fi o Ethernet y la impresora lo ve aparecer como si alguien hubiera insertado la memoria.

```
  PC / teléfono                     Raspberry Pi                          impresora Anycubic
  navegador con LitoMask   Wi-Fi    litomask-usb.py (HTTP :8080)  cable    puerto USB-A
  http://litomask.local:8080 ────▶  imagen FAT32 usb.img          ───────▶  "memoria LITOMASK"
                                    módulo g_mass_storage          USB
```

Flujo de cada envío: la Pi "retira" la memoria (descarga el módulo `g_mass_storage`), monta
la imagen, escribe el archivo en streaming, desmonta y vuelve a "insertar" la memoria. La
impresora la relee y muestra el archivo nuevo. **La impresión se lanza igual que siempre, desde
la pantalla táctil de la impresora.**

Todo el software del puente está en esta carpeta: un único script de Python sin dependencias
(`litomask-usb.py`), el instalador (`install.sh`), la unidad de systemd y este documento.

## Hardware

El puerto USB de la Pi tiene que poder trabajar en **modo periférico** (USB *gadget*). No
todas las placas lo permiten:

| Placa | ¿Sirve? | Puerto que va a la impresora | Alimentación |
| --- | --- | --- | --- |
| **Pi Zero 2 W** (recomendada) | Sí | micro-USB marcado **"USB"** (el del centro), **no** el marcado "PWR IN" | Normalmente basta con el propio puerto de la impresora (la Zero 2 W consume 0.1-0.3 A) |
| Pi Zero W | Sí (más lenta) | ídem | ídem |
| Pi Zero (sin Wi-Fi) | Solo con adaptador de red | ídem | ídem |
| Pi 4 B / Pi 400 | Sí | el **USB-C** (el de alimentación) con un cable de datos | No la puede alimentar la impresora: 5 V por los pines GPIO (2/4 = 5 V, 6 = GND) desde una fuente de 3 A, o por un hub/PoE |
| Pi 5 | Sí | el **USB-C** de alimentación con cable de datos | Igual que la Pi 4 (5 V por GPIO); necesita una fuente de 5 A para rendir bien |
| Pi 3 B / 3 B+ / 2 B / 1 B / B+ | **No** | — | Su USB pasa por un hub interno que solo funciona como host |
| Pi 3 A+ / 1 A+ | En teoría sí | micro-USB de datos | No probado |

Cables:

- Entre la Pi y la impresora hace falta un cable **de datos** (micro-USB o USB-C a USB-A). Muchos
  cables de cargador solo llevan los hilos de 5 V y no funcionan: prueba primero que el cable
  sirva para pasar archivos entre un teléfono y una PC.
- En la Pi Zero, si al alimentarla desde la impresora aparece el rayo de bajo voltaje o se
  reinicia sola, conecta además un cargador a "PWR IN" (funciona con los dos puertos conectados;
  lo más limpio es entonces un cable de datos sin hilo de 5 V hacia la impresora).
- Si la impresora alimenta la Pi, la Pi se apaga y arranca con la impresora (tarda 30-60 s en
  volver a exponer la memoria).

Red: la Pi y la PC tienen que verse en la misma red (Wi-Fi del laboratorio, un router propio o
el punto de acceso de un teléfono). Las redes de universidad a veces aíslan a los clientes
Wi-Fi entre sí; en ese caso usa un router propio o conecta la PC por Ethernet al mismo router.

## Instalación paso a paso

1. **Graba Raspberry Pi OS Lite (64-bit, Bookworm o posterior)** en la microSD con Raspberry Pi
   Imager. En *Editar ajustes* pon nombre de host `litomask`, tu usuario y contraseña, la red
   Wi-Fi del laboratorio (país `MX`) y activa SSH. Arranca la Pi con la microSD y espera 1-2 min.
2. **Entra por SSH** desde la PC (misma red):

   ```bash
   ssh usuario@litomask.local
   ```

   Si `litomask.local` no resuelve, busca la IP de la Pi en el router o usa
   `ssh usuario@raspberrypi.local` si dejaste el nombre por defecto.
3. **Descarga esta carpeta** en la Pi (cualquiera de las dos formas):

   ```bash
   git clone --depth 1 https://github.com/ROMERUU-dev/litomask.git
   # o, sin git:
   curl -L https://github.com/ROMERUU-dev/litomask/archive/refs/heads/main.tar.gz | tar xz && mv litomask-main litomask
   ```
4. **Ejecuta el instalador** (necesita internet la primera vez para las dependencias y la app):

   ```bash
   sudo ./litomask/pi/install.sh
   ```

   Opciones útiles: `--size 8G` (tamaño de la memoria emulada; por defecto 4G),
   `--hostname` / `--no-hostname` (fijar o no el nombre `litomask` sin preguntar),
   `--dist litomask-dist.zip` (instalar la app desde un zip que ya tengas, sin internet),
   `--yes` (sin preguntas). Se puede volver a ejecutar para actualizar el servidor y la app; la
   imagen y su contenido se conservan.
5. **Reinicia** (`sudo reboot`) para que se active el USB en modo periférico.
6. **Conecta el cable** de la Pi al puerto USB de la impresora. En la pantalla de la impresora
   debe aparecer la memoria (vacía). Desde la PC comprueba el servicio:

   ```bash
   curl http://litomask.local:8080/api/status
   ```

   Debe responder `{"ok": true, ..., "exported": true, ...}`. Si `exported` es `false`, mira
   la sección de problemas.

## Abrir LitoMask desde la Pi

La Pi sirve una copia completa de la app en **<http://litomask.local:8080>** (o
`http://IP-de-la-Pi:8080`). Es la misma app que <https://romeruu-dev.github.io/litomask/>, con
la ventaja de que la página y el puente están en el mismo origen, así que el botón de envío
funciona sin configurar nada. Una vez instalada no necesita internet. Guárdala en marcadores.

Para actualizar la app a la última versión publicada basta con volver a ejecutar
`sudo ./litomask/pi/install.sh` (descarga `litomask-dist.zip` de la release `latest`).

Notas sobre `litomask.local`: funciona en Linux, macOS, Windows 10/11 e iOS gracias a mDNS. En
Android y en Windows antiguos hay que usar la IP (en la Pi: `hostname -I`).

## La sección "Enviar a la impresora" de la app

En LitoMask, después de la exportación, está la sección **6 · Enviar a la impresora**:

1. **Dirección del puente**: por defecto `http://litomask.local:8080`; vale escribir solo el
   nombre o la IP de la Pi (`192.168.1.20`, con `:puerto` si no es el 8080). Se recuerda en el
   navegador. Si abres la app desde la propia Pi, se detecta sola.
2. **Probar conexión**: consulta `GET /api/status` y muestra una línea de estado
   (`memoria USB «LITOMASK» · visible para la impresora · puente v1.0`), el espacio libre y la
   lista *Archivos en la memoria*, con un botón **Borrar** por archivo.
3. **Enviar a la impresora**: genera los mismos archivos que la descarga (el de exposición y,
   si toca, los de doble patronado y alineación) y los sube uno a uno con
   `PUT /api/files/nombre.pm4u`, con porcentaje de progreso. Durante la subida la memoria está
   desconectada de la impresora; al terminar se reconecta sola y aparece
   *"N archivo(s) enviado(s); la memoria USB se ha reconectado a la impresora"*.
4. **Reconectar memoria**: vuelve a "sacar y meter" la memoria sin cambiar nada
   (`POST /api/reconnect`), por si la impresora no refrescó la lista.

Luego, en la impresora: elegir el archivo en la memoria USB y pulsar imprimir, como con
cualquier pendrive. Si la página se abrió por HTTPS (GitHub Pages), la sección avisa de que el
navegador bloquea la llamada y enlaza a la dirección de la Pi (ver más abajo).

También se puede usar sin la app, desde una terminal de la PC:

```bash
curl -T mascara.pm4u http://litomask.local:8080/api/files/mascara.pm4u   # subir
curl http://litomask.local:8080/api/files                                # listar
curl -X DELETE http://litomask.local:8080/api/files/mascara.pm4u          # borrar
curl -X POST http://litomask.local:8080/api/reconnect                     # reconectar
```

## Por qué desde GitHub Pages el botón no puede hablar con la Pi

<https://romeruu-dev.github.io/litomask/> se sirve por **HTTPS**, y el puente de la Pi solo
habla **HTTP** (no puede tener un certificado válido para `litomask.local` ni para una IP
privada). Los navegadores bloquean que una página HTTPS haga peticiones a `http://…` ("mixed
content", contenido mixto), así que desde GitHub Pages el envío falla con un error de red
aunque el servicio permita CORS. Alternativas, de mejor a peor:

1. **Abrir la app desde la Pi**: <http://litomask.local:8080>. Es lo recomendado y lo que se
   describe arriba.
2. **Generar en GitHub Pages y subir aparte**: descarga el archivo como siempre y súbelo con
   `curl -T` (arriba) o desde la página de la Pi.
3. **Servir la app por HTTP en la PC**: `npm run dev` en el repositorio, o
   `python3 -m http.server 8000` dentro de `dist/`; de `http://` a `http://` no hay bloqueo.
4. **Permitir contenido inseguro en el navegador** para `romeruu-dev.github.io` (Chrome: candado
   → *Configuración del sitio* → *Contenido no seguro* → *Permitir*; Firefox: `about:config` →
   `security.mixed_content.block_active_content` = `false`). Funciona, pero baja la seguridad
   de ese sitio en tu navegador; úsalo solo si entiendes lo que hace.

## Limitaciones

- **El disparo de la impresión sigue siendo manual**, desde la pantalla táctil de la impresora.
  El puente solo entrega el archivo.
- **Al enviar, la memoria se desconecta** durante toda la subida más unos segundos, y la
  impresora ve que la "sacaron". **No envíes nada mientras la impresora está imprimiendo o
  leyendo la memoria**: interrumpiría la lectura (y con casi toda seguridad la impresión).
- Se atiende **una operación a la vez**; una segunda subida simultánea recibe `409 ocupado`.
  Si el cliente deja de enviar datos durante 120 s a mitad de una subida, el servicio la
  abandona (sin dejar temporales) y vuelve a exponer la memoria.
- La imagen es un FAT32 "sin tabla de particiones" (como `mkfs.vfat` sobre el archivo entero).
  Las PC y la mayoría de firmwares Linux la leen sin problema, pero no está comprobado con la
  impresora; si la Pi aparece como memoria en una PC y la impresora aun así no la ve, ese es el
  primer sospechoso (haría falta crear la imagen con una partición MBR).
- La lista de archivos que muestra la app es la última que leyó el puente (se actualiza en cada
  envío, borrado o reconexión). Si borras archivos desde la pantalla de la impresora, pulsa
  *Reconectar* (o pide `/api/status?refresh=1`) para que la lista se ponga al día.
- FAT32: archivos de menos de 4 GiB e imagen de hasta 32 GB (por defecto 4 GB). Un `.pm4u` de la
  Mono 4 Ultra ocupa decenas o cientos de MB según las capas.
- Velocidad: por la Wi-Fi de una Pi Zero 2 W se suben unos 2-4 MB/s (un archivo de 100 MB tarda
  entre medio minuto y un minuto). La Pi 4/5 por Ethernet es mucho más rápida.
- El servicio no tiene autenticación: cualquiera en la misma red puede subir o borrar archivos
  de la memoria. Está pensado para la red del laboratorio.
- La Pi tarda 30-60 s tras arrancar en exponer la memoria (más si la alimenta la impresora y
  esta se acaba de encender).

## Solución de problemas

**La impresora no ve ninguna memoria.**

- Cable solo de carga: cambia a un cable de datos (pruébalo con un teléfono).
- Puerto equivocado: en la Pi Zero es el micro-USB marcado "USB", no "PWR IN". En la Pi 4/5 es el
  USB-C.
- El modo periférico no está activo. En la Pi: `ls /sys/class/udc` tiene que listar un
  controlador (`3f980000.usb`, `fe980000.usb`, `1000480000.usb`…). Si está vacío, revisa que
  `config.txt` tenga `dtoverlay=dwc2,dr_mode=peripheral`, que `cmdline.txt` tenga
  `modules-load=dwc2`, y que no haya un `otg_mode=1` fuera de las secciones `[cm4]`/`[cm5]`.
  Reinicia después de cambiarlo.
- El módulo no está cargado: `lsmod | grep g_mass_storage` y
  `journalctl -u litomask-usb -n 50`. Un `modprobe: No such device` significa que dwc2 no está
  en modo periférico (punto anterior).
- Imagen no válida: `file /var/lib/litomask/usb.img` debe decir `FAT (32 bit)`. Volúmenes de
  más de 32 GB, o con otro sistema de archivos (exFAT, NTFS, ext4), no los lee la impresora.
  Para rehacerla: `sudo ./litomask/pi/install.sh --recreate-image --size 4G` (borra el contenido).
- Alimentación insuficiente (rayo en pantalla, reinicios): alimenta la Pi aparte.

**La impresora ve la memoria pero no el archivo.**

- Espera unos segundos y pulsa *Reconectar*; algunas impresoras no refrescan hasta volver al
  menú de archivos.
- La extensión no es la del modelo (la Mono 4 Ultra solo lista `.pm4u`; la Mono 2, `.pm3n`).
- Se está escribiendo todavía (el estado dice `exported: false`).

**La impresora dice que la memoria está dañada o pide formatear.** Suele pasar si la Pi se
apagó a mitad de una escritura. Con el servicio parado (`sudo systemctl stop litomask-usb`):
`sudo fsck.vfat -a /var/lib/litomask/usb.img`, y arranca de nuevo el servicio. Si no se arregla,
recrea la imagen (`--recreate-image`).

**`litomask.local` no responde.** Usa la IP (`hostname -I` en la Pi). Comprueba que avahi
está activo (`systemctl status avahi-daemon`) y que la PC y la Pi están en la misma red sin
aislamiento de clientes. El servicio escucha en IPv4 e IPv6.

**`409 ocupado`.** Hay otra subida o reconexión en curso; espera a que termine.

**`507 no hay espacio`.** Borra archivos viejos desde la app o crea una imagen mayor
(`--recreate-image --size 16G`).

**Error de red o "Failed to fetch" desde GitHub Pages.** Es el bloqueo de contenido mixto:
abre la app desde la Pi (sección anterior).

**La subida es muy lenta.** La imagen se monta con `sync` (cada bloque se escribe de inmediato
a la microSD), que en tarjetas lentas limita la velocidad. Se puede quitar poniendo
`LITOMASK_OPTS="--mount-options loop"` en `/etc/default/litomask-usb` y
`sudo systemctl restart litomask-usb`: el servicio sigue haciendo `fsync` y desmontando antes
de exponer la memoria, así que el archivo queda igual de completo en la imagen.

**Ver qué está pasando.** `journalctl -u litomask-usb -f` muestra cada petición, cada
`modprobe`/`mount` y los errores. `python3 /opt/litomask/litomask-usb.py --help` lista las
opciones del servidor.

## Qué está probado y qué no

Probado en una PC (modo `--dev`, sin gadget) con `curl`: preflight `OPTIONS`, `GET /api/status`
y `/api/files`, `PUT` de un archivo binario de 7 MB comprobado byte a byte (también con
`Expect: 100-continue`), nombres inválidos (`400`), `413`, `507` (con espacio simulado), `409`
con dos subidas simultáneas, cliente que se corta a mitad (no deja temporales), cliente que se
queda parado a mitad (el timeout libera la memoria y la siguiente subida funciona),
`Content-Length` negativo o malformado, bytes nulos y `..` en rutas y nombres, `DELETE` y
`404`, `POST /api/reconnect`, servicio de la app estática con *fallback* a `index.html`,
intentos de salir de la carpeta `www` (también por enlaces simbólicos), y cierre limpio con
`SIGTERM`. La "danza" del modo
gadget (`modprobe -r` → `mount` → escribir → `umount` → `modprobe`) se revisó con `modprobe`,
`mount` y `umount` simulados, incluidos los caminos de error.

**No probado por falta de hardware**: el modo gadget en una Raspberry Pi real (que la impresora
detecte la memoria, los tiempos de reconexión, la velocidad real), `install.sh` sobre
Raspberry Pi OS (edición de `config.txt`/`cmdline.txt`, `apt`, `systemd`), y el comportamiento
del firmware de la impresora al perder la memoria a mitad de una lectura. Antes de usarlo con la
impresora conviene probar la Pi contra una PC: conectada por el cable USB, la PC debe montar
una memoria `LITOMASK`; sube un archivo con `curl -T` y comprueba que la PC ve cómo la memoria
desaparece y vuelve con el archivo dentro.

## Desinstalar

```bash
sudo ./litomask/pi/uninstall.sh          # quita el servicio, /opt/litomask y dwc2 del arranque
sudo ./litomask/pi/uninstall.sh --purge  # además borra la imagen con sus archivos
```

El nombre de host no se revierte (`sudo hostnamectl set-hostname raspberrypi` si hace falta).

## API del puente (para otros clientes)

Todas las respuestas `/api/*` llevan `Access-Control-Allow-Origin: *`; `OPTIONS /api/*`
responde `204` con las cabeceras CORS (permite `GET, PUT, POST, DELETE, OPTIONS` y la cabecera
`Content-Type`).

| Petición | Respuesta |
| --- | --- |
| `GET /api/status` | `{ok, service:"litomask-usb", version:"1.0", mode:"gadget"\|"dev", exported, label, free_bytes, total_bytes, files:[{name,size,mtime}]}` |
| `GET /api/files` | `{files:[{name,size,mtime}]}` |
| `PUT /api/files/{name}` (cuerpo en bruto, `Content-Length` obligatorio) | `200 {ok:true,name,size}`; `400` nombre inválido; `409` ocupado; `413` supera 4 GiB; `507` sin espacio |
| `DELETE /api/files/{name}` | `200 {ok:true}`; `404` si no existe |
| `POST /api/reconnect` | `200 {ok:true, exported:true}` |
| `GET /api/status?refresh=1`, `GET /api/files?refresh=1` | igual, pero releyendo la memoria (implica una reconexión) |

Nombres válidos: solo el nombre (sin carpetas), `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, sin `..`,
con extensión (sin distinguir mayúsculas) `pm3n pm4u pwmx pwma pwmb pwmo pwms pws pwx pw0 pm3
pm3m pmsq dlp pm4n pm7 pm7m pwsz ctb goo prz zip png`. Cualquier otra ruta sirve la app estática
de `/opt/litomask/www` (con `index.html` como respaldo).

## Archivos de esta carpeta

| Archivo | Qué es |
| --- | --- |
| `litomask-usb.py` | Servidor HTTP + gadget USB (Python 3.11+, solo biblioteca estándar). `--dev DIR` para probar en cualquier PC sin root. |
| `install.sh` | Instalador para Raspberry Pi OS (con `sudo`). |
| `uninstall.sh` | Desinstalador. |
| `litomask-usb.service` | Unidad de systemd (se copia a `/etc/systemd/system/`). |

Rutas en la Pi tras instalar: servidor y app en `/opt/litomask/`, imagen en
`/var/lib/litomask/usb.img`, punto de montaje temporal `/var/lib/litomask/mnt`, opciones extra
en `/etc/default/litomask-usb`.
