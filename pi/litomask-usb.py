#!/usr/bin/env python3
"""LitoMask USB bridge: presents a Raspberry Pi as a USB memory stick to an
Anycubic resin printer and receives the exposure files over HTTP.

Only the Python standard library is used (Raspberry Pi OS Bookworm, Python
3.11+). The service listens on all interfaces (default port 8080) and:

  * exposes a FAT32 image through the ``g_mass_storage`` gadget module so the
    printer sees a normal USB stick ("gadget" mode, needs root);
  * accepts files from the LitoMask web app (or ``curl``) with ``PUT
    /api/files/{name}``: the stick is unplugged (module removed), the image is
    mounted, the body is streamed into it, the image is unmounted and the stick
    is plugged back in so the printer rescans it;
  * serves the static LitoMask app from ``--www`` so the page and the API share
    the same origin (an HTTPS page such as GitHub Pages cannot call a plain
    ``http://`` address on the LAN because of the mixed-content rule).

``--dev DIR`` runs the same HTTP contract against a plain directory, without
root or gadget, to test on any PC.

HTTP contract (must match src/ in the LitoMask app exactly):

  GET    /api/status        -> {ok, service, version, mode, exported, label,
                                free_bytes, total_bytes, files:[{name,size,mtime}]}
  GET    /api/files         -> {files:[{name,size,mtime}]}
  PUT    /api/files/{name}  -> raw body (Content-Length required)
                               200 {ok:true,name,size} | 400 | 409 | 413 | 507
  DELETE /api/files/{name}  -> 200 {ok:true} | 404
  POST   /api/reconnect     -> 200 {ok:true, exported:true}
  OPTIONS /api/*            -> 204 with CORS headers

``GET /api/status?refresh=1`` and ``GET /api/files?refresh=1`` force a
re-read of the image (unplug/mount/list/plug). Without ``refresh`` the listing
comes from the inventory cached after the last operation, so polling the
status never disturbs the printer while it reads the stick.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import logging
import mimetypes
import os
import posixpath
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Iterator
from urllib.parse import parse_qs, unquote, urlsplit

SERVICE_NAME = "litomask-usb"
SERVICE_VERSION = "1.0"

# ---- File-name contract ------------------------------------------------------

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
ALLOWED_EXTENSIONS = frozenset(
    (
        "pm3n pm4u pwmx pwma pwmb pwmo pwms pws pwx pw0 pm3 pm3m pmsq dlp "
        "pm4n pm7 pm7m pwsz ctb goo prz zip png"
    ).split()
)

# FAT32 cannot hold a file of 4 GiB or more.
FAT32_MAX_FILE = 2**32 - 1
# Slack kept free on the volume for directory entries / FAT rounding.
FREE_SPACE_MARGIN = 4 * 1024 * 1024
# Streaming block size for request bodies and static files.
CHUNK = 1024 * 1024
# Pause between "unplug" and "plug" so the printer notices the change.
REPLUG_DELAY = 1.0
# Socket idle timeout: a client that stops sending mid-upload must not keep the
# global lock (and the stick unplugged) forever.
SOCKET_TIMEOUT = 120.0
# Largest request body we bother to read and discard on DELETE/POST.
DRAIN_MAX = 1024 * 1024
CONTENT_LENGTH_RE = re.compile(r"^[0-9]{1,20}$")
# Files the printer or the OS may leave on the stick that we never list.
HIDDEN_NAMES = {"System Volume Information"}

log = logging.getLogger(SERVICE_NAME)


def valid_name(name: str) -> bool:
    """True when ``name`` is a bare file name accepted by the contract."""
    if not NAME_RE.fullmatch(name) or ".." in name:
        return False
    if "." not in name:
        return False
    return name.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def run(cmd: list[str], timeout: float = 60.0) -> subprocess.CompletedProcess[str]:
    """Run a system command (argument list, never a shell). A missing binary or
    a hang becomes a StorageError so the caller's cleanup path still runs."""
    log.debug("$ %s", " ".join(cmd))
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as e:
        raise StorageError(f"{cmd[0]} no terminó en {timeout:g} s") from e
    except OSError as e:
        raise StorageError(f"no se pudo ejecutar {cmd[0]}: {e}") from e


def fsync_dir(path: str) -> None:
    """Flush the directory entry after a rename/unlink (best effort on vfat)."""
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def list_dir(path: str) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    with os.scandir(path) as it:
        for entry in it:
            if entry.name.startswith(".") or entry.name in HIDDEN_NAMES:
                continue
            try:
                if not entry.is_file(follow_symlinks=False):
                    continue
                st = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            files.append({"name": entry.name, "size": st.st_size, "mtime": int(st.st_mtime)})
    files.sort(key=lambda f: f["name"].lower())
    return files


def free_total(path: str) -> tuple[int, int]:
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize, st.f_blocks * st.f_frsize


# ---- Errors ------------------------------------------------------------------


class ApiError(Exception):
    """An error that becomes a JSON response with the given HTTP status."""

    def __init__(self, status: int, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


class StorageError(Exception):
    """A gadget/mount operation failed (reported as HTTP 500)."""


class ClientGone(Exception):
    """The client closed the connection before sending the whole body."""


# ---- Storage back-ends -------------------------------------------------------


class Storage:
    """Common interface. ``lock`` serialises every operation that touches the
    volume; handlers take it non-blocking and answer 409 when busy."""

    mode = "dev"

    def __init__(self, label: str) -> None:
        self.label = label
        self.lock = threading.Lock()

    # -- to override
    def startup(self) -> None:  # pragma: no cover - trivial
        pass

    def shutdown(self) -> None:  # pragma: no cover - trivial
        pass

    def is_exported(self) -> bool:
        return True

    def inventory(self) -> tuple[int, int, list[dict[str, Any]]]:
        raise NotImplementedError

    @contextlib.contextmanager
    def session(self) -> Iterator[str]:
        """Yield a directory where files can be read/written. Must be called
        with ``lock`` held."""
        raise NotImplementedError

    def reconnect(self) -> None:
        """Unplug and plug the stick again. Must be called with ``lock`` held."""

    # -- shared
    def status(self) -> dict[str, Any]:
        free, total, files = self.inventory()
        return {
            "ok": True,
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "mode": self.mode,
            "exported": self.is_exported(),
            "label": self.label,
            "free_bytes": free,
            "total_bytes": total,
            "files": files,
        }


class DevStorage(Storage):
    """Plain directory, no gadget. Everything is live; reconnect is a no-op."""

    mode = "dev"

    def __init__(self, directory: str, label: str) -> None:
        super().__init__(label)
        self.directory = os.path.abspath(directory)

    def startup(self) -> None:
        os.makedirs(self.directory, exist_ok=True)
        log.info("modo desarrollo: los archivos se guardan en %s (sin gadget USB)", self.directory)

    def inventory(self) -> tuple[int, int, list[dict[str, Any]]]:
        free, total = free_total(self.directory)
        return free, total, list_dir(self.directory)

    @contextlib.contextmanager
    def session(self) -> Iterator[str]:
        yield self.directory

    def reconnect(self) -> None:
        log.info("reconnect: nada que hacer en modo desarrollo")


class GadgetStorage(Storage):
    """FAT32 image exported with g_mass_storage. Every write follows the dance:
    modprobe -r (unplug) -> mount -> write -> umount -> modprobe (plug)."""

    mode = "gadget"
    MODULE = "g_mass_storage"
    SYS_MODULE = "/sys/module/g_mass_storage"
    UDC_DIR = "/sys/class/udc"

    def __init__(self, image: str, mount: str, label: str, mount_options: str) -> None:
        super().__init__(label)
        self.image = os.path.abspath(image)
        self.mount = os.path.abspath(mount)
        self.mount_options = mount_options
        self._mounted = False
        self._cache: tuple[int, int, list[dict[str, Any]]] = (0, 0, [])
        self._cache_time = 0.0

    # -- helpers
    def _module_loaded(self) -> bool:
        return os.path.isdir(self.SYS_MODULE)

    def _udc_available(self) -> bool:
        try:
            return bool(os.listdir(self.UDC_DIR))
        except OSError:
            return False

    def _unexport(self) -> None:
        if not self._module_loaded():
            return
        log.info("retirando la memoria USB (modprobe -r %s)", self.MODULE)
        last = ""
        for _ in range(5):
            r = run(["modprobe", "-r", self.MODULE])
            if not self._module_loaded():
                return
            last = (r.stderr or r.stdout).strip()
            time.sleep(0.5)
        raise StorageError(f"no se pudo retirar {self.MODULE}: {last or 'sigue cargado'}")

    def _export(self) -> bool:
        if self._mounted:
            log.error("la imagen sigue montada; NO se expone para no corromperla")
            return False
        if self._module_loaded():
            return True
        if not self._udc_available():
            log.error(
                "no hay controlador USB en modo periférico (%s vacío): revisa "
                "dtoverlay=dwc2,dr_mode=peripheral en config.txt, modules-load=dwc2 "
                "en cmdline.txt y reinicia",
                self.UDC_DIR,
            )
            return False
        log.info("exponiendo la memoria USB (modprobe %s file=%s)", self.MODULE, self.image)
        r = run(["modprobe", self.MODULE, f"file={self.image}", "stall=0", "removable=1"])
        if r.returncode != 0 or not self._module_loaded():
            log.error("modprobe %s falló: %s", self.MODULE, (r.stderr or r.stdout).strip())
            return False
        return True

    def _mount(self) -> None:
        if os.path.ismount(self.mount):
            log.warning("%s ya estaba montado (¿cierre sucio?); desmontando primero", self.mount)
            self._mounted = True
            self._umount()
        os.makedirs(self.mount, exist_ok=True)
        r = run(["mount", "-t", "vfat", "-o", self.mount_options, self.image, self.mount])
        if r.returncode != 0:
            raise StorageError(f"mount falló: {(r.stderr or r.stdout).strip()}")
        self._mounted = True

    def _umount(self) -> None:
        last = ""
        for attempt in range(6):
            r = run(["umount", self.mount], timeout=300)
            if r.returncode == 0 or not os.path.ismount(self.mount):
                self._mounted = False
                return
            last = (r.stderr or r.stdout).strip()
            log.warning("umount falló (intento %d): %s", attempt + 1, last)
            time.sleep(0.5 * (attempt + 1))
        raise StorageError(f"umount falló: {last}")

    def _cleanup_parts(self, directory: str) -> None:
        """Remove ``.name.part`` leftovers from an interrupted upload."""
        try:
            names = os.listdir(directory)
        except OSError:
            return
        for name in names:
            if name.startswith(".") and name.endswith(".part"):
                log.warning("borrando temporal huérfano %s", name)
                with contextlib.suppress(OSError):
                    os.remove(os.path.join(directory, name))

    def _refresh_cache(self) -> None:
        try:
            free, total = free_total(self.mount)
            self._cache = (free, total, list_dir(self.mount))
            self._cache_time = time.time()
        except OSError as e:
            log.warning("no se pudo leer el inventario: %s", e)

    # -- interface
    def startup(self) -> None:
        if os.geteuid() != 0:
            raise SystemExit("el modo gadget necesita root (o usa --dev DIR para probar)")
        if not os.path.isfile(self.image):
            raise SystemExit(f"no existe la imagen {self.image}; ejecuta install.sh")
        if not self._udc_available():
            log.warning(
                "no hay controlador USB periférico en %s; la memoria no se podrá exponer "
                "hasta que dwc2 esté activo (config.txt/cmdline.txt + reinicio)",
                self.UDC_DIR,
            )
        # Read the inventory once, then expose the stick.
        with self.lock:
            try:
                with self.session():
                    pass
            except StorageError as e:
                log.error("inventario inicial: %s", e)
        log.info(
            "imagen %s (%s), montaje en %s, opciones '%s', expuesta=%s",
            self.image,
            self.label,
            self.mount,
            self.mount_options,
            self.is_exported(),
        )

    def shutdown(self) -> None:
        # Wait for an in-flight operation (it re-exports on its own), then make
        # sure the stick is visible to the printer before exiting.
        if not self.lock.acquire(timeout=90):
            log.error("hay una operación que no termina; se sale sin tocar la imagen")
            return
        try:
            if self._mounted or os.path.ismount(self.mount):
                self._mounted = True
                with contextlib.suppress(StorageError):
                    self._umount()
            self._export()
        finally:
            self.lock.release()

    def is_exported(self) -> bool:
        return self._module_loaded() and not self._mounted

    def inventory(self) -> tuple[int, int, list[dict[str, Any]]]:
        return self._cache

    @contextlib.contextmanager
    def session(self) -> Iterator[str]:
        try:
            self._unexport()
            self._mount()
            try:
                self._cleanup_parts(self.mount)
                yield self.mount
            finally:
                self._refresh_cache()
                self._umount()
        finally:
            self._export()

    def reconnect(self) -> None:
        # Doing the full dance also refreshes the inventory.
        self._unexport()
        try:
            self._mount()
            try:
                self._refresh_cache()
            finally:
                self._umount()
            time.sleep(REPLUG_DELAY)
        finally:
            if not self._export():
                raise StorageError("no se pudo volver a exponer la memoria USB")


# ---- HTTP handler ------------------------------------------------------------

CORS_HEADERS = (
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS"),
    ("Access-Control-Allow-Headers", "Content-Type"),
    ("Access-Control-Max-Age", "600"),
)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"{SERVICE_NAME}/{SERVICE_VERSION}"
    sys_version = ""
    # Applied to the socket by StreamRequestHandler: reads/writes that stall
    # longer than this raise TimeoutError and the request is abandoned.
    timeout = SOCKET_TIMEOUT

    # Filled in by ``serve()``.
    storage: Storage
    www: str | None

    def handle_expect_100(self) -> bool:
        # The stdlib answers "100 Continue" before the handler runs, which
        # makes the client send the body even when we are about to reject the
        # request (bad name, no space, busy). Defer it: ``_continue()`` sends
        # it once the request has been accepted.
        self._expect_continue = True
        return True

    def _continue(self) -> None:
        """Send the deferred ``100 Continue`` (once) before reading the body."""
        if getattr(self, "_expect_continue", False):
            self._expect_continue = False
            self.send_response_only(HTTPStatus.CONTINUE)
            self.end_headers()

    # -- logging
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: D401
        log.info("%s %s", self.address_string(), fmt % args)

    def log_error(self, fmt: str, *args: Any) -> None:
        log.warning("%s %s", self.address_string(), fmt % args)

    # -- helpers
    def _split(self) -> tuple[str, dict[str, list[str]]]:
        parts = urlsplit(self.path)
        return unquote(parts.path), parse_qs(parts.query)

    def _send_cors(self) -> None:
        for k, v in CORS_HEADERS:
            self.send_header(k, v)

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _api_name(self, path: str) -> str:
        """Extract and validate the name in ``/api/files/{name}``."""
        name = path[len("/api/files/") :]
        if not valid_name(name):
            raise ApiError(400, "nombre de archivo no válido")
        return name

    @contextlib.contextmanager
    def _storage_op(self) -> Iterator[str]:
        """Take the global lock (409 if busy) and open a storage session."""
        storage = self.storage
        if not storage.lock.acquire(blocking=False):
            raise ApiError(409, "ocupado: hay otra operación en curso")
        try:
            with storage.session() as directory:
                yield directory
        finally:
            storage.lock.release()

    def _dispatch_api(self, path: str, query: dict[str, list[str]]) -> None:
        try:
            try:
                self._route_api(path, query)
            except ApiError as e:
                log.warning("%s %s -> %d %s", self.command, path, e.status, e.message)
                self._send_json(e.status, {"ok": False, "error": e.message, **e.extra})
            except StorageError as e:
                log.error("%s %s -> 500 %s", self.command, path, e)
                self.close_connection = True
                self._send_json(500, {"ok": False, "error": str(e), "exported": self.storage.is_exported()})
            except ClientGone:
                log.warning("%s %s: el cliente cerró la conexión antes de terminar", self.command, path)
                self.close_connection = True
            except TimeoutError:
                log.warning("%s %s: el cliente dejó de enviar datos (%.0f s); se abandona", self.command, path, SOCKET_TIMEOUT)
                self.close_connection = True
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
            except Exception as e:  # noqa: BLE001 - last resort, never leave the client hanging
                log.exception("%s %s: error inesperado", self.command, path)
                self.close_connection = True
                self._send_json(500, {"ok": False, "error": f"error interno: {e}"})
        except OSError:
            # The client went away while we were answering; nothing else to do.
            self.close_connection = True

    def _route_api(self, path: str, query: dict[str, list[str]]) -> None:
        method = self.command
        refresh = query.get("refresh", ["0"])[0] not in ("", "0", "false", "no")

        if method == "OPTIONS":
            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if path == "/api/status":
            if method not in ("GET", "HEAD"):
                raise ApiError(405, "método no permitido")
            if refresh:
                with self._storage_op():
                    pass
            self._send_json(200, self.storage.status())
            return

        if path == "/api/files":
            if method not in ("GET", "HEAD"):
                raise ApiError(405, "método no permitido")
            if refresh:
                with self._storage_op():
                    pass
            _, _, files = self.storage.inventory()
            self._send_json(200, {"files": files})
            return

        if path == "/api/reconnect":
            if method != "POST":
                raise ApiError(405, "método no permitido")
            self._drain_body()
            storage = self.storage
            if not storage.lock.acquire(blocking=False):
                raise ApiError(409, "ocupado: hay otra operación en curso")
            try:
                storage.reconnect()
            finally:
                storage.lock.release()
            self._send_json(200, {"ok": True, "exported": storage.is_exported()})
            return

        if path.startswith("/api/files/"):
            if method == "PUT":
                self._api_put(path)
                return
            if method == "DELETE":
                self._api_delete(path)
                return
            raise ApiError(405, "método no permitido")

        raise ApiError(404, "ruta no encontrada")

    def _drain_body(self) -> None:
        """Consume a (small) request body we do not care about. Anything
        bigger than DRAIN_MAX is left unread and the connection closed."""
        raw = (self.headers.get("Content-Length") or "0").strip()
        length = int(raw) if CONTENT_LENGTH_RE.fullmatch(raw) else 0
        if length > DRAIN_MAX:
            self.close_connection = True
            return
        if length > 0:
            self._continue()
        while length > 0:
            chunk = self.rfile.read(min(CHUNK, length))
            if not chunk:
                break
            length -= len(chunk)

    def _api_put(self, path: str) -> None:
        # Any early rejection leaves the body unread: close the connection so
        # the leftover bytes are not parsed as the next request.
        keep_alive_wanted = not self.close_connection
        self.close_connection = True
        name = self._api_name(path)
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ApiError(411, "falta la cabecera Content-Length")
        raw_length = raw_length.strip()
        if not CONTENT_LENGTH_RE.fullmatch(raw_length):
            raise ApiError(400, "Content-Length no válido")
        length = int(raw_length)
        if length <= 0:
            raise ApiError(400, "el cuerpo está vacío")
        if length > FAT32_MAX_FILE:
            raise ApiError(413, "el archivo supera el máximo de FAT32 (4 GiB)")

        log.info("recibiendo %s (%d bytes)", name, length)
        started = time.monotonic()
        with self._storage_op() as directory:
            free, _ = free_total(directory)
            if length + FREE_SPACE_MARGIN > free:
                raise ApiError(
                    507,
                    f"no hay espacio en la memoria: faltan {length + FREE_SPACE_MARGIN - free} bytes",
                    free_bytes=free,
                )
            final = os.path.join(directory, name)
            tmp = os.path.join(directory, f".{name}.part")
            # Request accepted: only now let a "100-continue" client send the body.
            self._continue()
            try:
                # Fresh file, never through a symlink (a stale .part is removed first).
                with contextlib.suppress(FileNotFoundError):
                    os.remove(tmp)
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
                with os.fdopen(fd, "wb") as fh:
                    remaining = length
                    while remaining > 0:
                        chunk = self.rfile.read(min(CHUNK, remaining))
                        if not chunk:
                            raise ClientGone()
                        fh.write(chunk)
                        remaining -= len(chunk)
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, final)
                fsync_dir(directory)
            except BaseException:
                with contextlib.suppress(OSError):
                    os.remove(tmp)
                raise
        elapsed = time.monotonic() - started
        log.info(
            "guardado %s (%d bytes en %.1f s, %.1f MB/s)",
            name,
            length,
            elapsed,
            length / max(elapsed, 1e-3) / 1e6,
        )
        # Body fully consumed: keep-alive is safe again.
        self.close_connection = not keep_alive_wanted
        # ``exported`` is extra to the contract: false means the file is saved
        # but the stick could not be re-exposed (see the log).
        self._send_json(
            200, {"ok": True, "name": name, "size": length, "exported": self.storage.is_exported()}
        )

    def _api_delete(self, path: str) -> None:
        self._drain_body()
        name = self._api_name(path)
        with self._storage_op() as directory:
            target = os.path.join(directory, name)
            if not os.path.isfile(target):
                raise ApiError(404, "el archivo no existe")
            os.remove(target)
            fsync_dir(directory)
        log.info("borrado %s", name)
        self._send_json(200, {"ok": True})

    # -- static files (the LitoMask app itself)
    def _serve_static(self, path: str) -> None:
        www = self.www
        if not www or not os.path.isdir(www):
            self._send_missing_app()
            return
        rel = posixpath.normpath(path).lstrip("/")
        if rel in ("", "."):
            rel = "index.html"
        root = os.path.realpath(www)
        target = os.path.realpath(os.path.join(root, rel))
        if target != root and not target.startswith(root + os.sep):
            target = os.path.join(root, "index.html")
        if not os.path.isfile(target):
            # SPA fallback: unknown routes render index.html.
            target = os.path.join(root, "index.html")
            if not os.path.isfile(target):
                self._send_missing_app()
                return
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        size = os.path.getsize(target)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        if "/assets/" in target.replace(os.sep, "/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(target, "rb") as fh:
            shutil.copyfileobj(fh, self.wfile, CHUNK)

    def _send_missing_app(self) -> None:
        body = (
            "<!doctype html><meta charset=utf-8><title>LitoMask USB</title>"
            "<body style='font-family:sans-serif;max-width:40em;margin:3em auto'>"
            "<h1>Puente USB de LitoMask</h1>"
            "<p>El servicio está funcionando, pero la aplicación web no está instalada en "
            f"<code>{self.www or '(sin --www)'}</code>.</p>"
            "<p>Vuelve a ejecutar <code>sudo ./install.sh</code> con conexión a internet, o "
            "descarga <code>litomask-dist.zip</code> de "
            "<a href='https://github.com/ROMERUU-dev/litomask/releases/latest'>la última "
            "release</a> y descomprímelo en esa carpeta.</p>"
            "<p>La API sigue disponible en <code>/api/status</code>.</p></body>"
        ).encode("utf-8")
        self.send_response(HTTPStatus.NOT_FOUND)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # -- verbs
    def _handle(self) -> None:
        try:
            self._handle_request()
        finally:
            # Never carry a pending "100 Continue" over to the next keep-alive request.
            self._expect_continue = False

    def _handle_request(self) -> None:
        path, query = self._split()
        if path == "/api" or path.startswith("/api/"):
            self._dispatch_api(path, query)
            return
        if self.command == "OPTIONS":
            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.command not in ("GET", "HEAD"):
            self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
            return
        if "\x00" in path:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        try:
            self._serve_static(path)
        except OSError:
            # Broken pipe, reset or timeout while sending: the client is gone.
            self.close_connection = True

    do_GET = _handle
    do_HEAD = _handle
    do_PUT = _handle
    do_POST = _handle
    do_DELETE = _handle
    do_OPTIONS = _handle


# ---- Server ------------------------------------------------------------------


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class DualStackServer(Server):
    """IPv4 + IPv6 on one socket, so ``litomask.local`` works whichever
    address family the browser tries first."""

    address_family = socket.AF_INET6

    def server_bind(self) -> None:
        with contextlib.suppress(OSError):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def make_server(bind: str, port: int) -> Server:
    if bind == "":
        try:
            return DualStackServer(("::", port), Handler)
        except OSError as e:
            log.warning("sin IPv6 dual-stack (%s); escuchando solo en IPv4", e)
    return Server((bind, port), Handler)


# ---- Entry point -------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog=SERVICE_NAME,
        description="Puente USB de LitoMask: la Raspberry Pi se presenta como memoria USB "
        "ante la impresora y recibe los archivos por HTTP.",
    )
    p.add_argument("--port", type=int, default=8080, help="puerto HTTP (8080)")
    p.add_argument("--bind", default="", help="dirección de escucha (todas)")
    p.add_argument("--image", default="/var/lib/litomask/usb.img", help="imagen FAT32 expuesta por USB")
    p.add_argument("--mount", default="/var/lib/litomask/mnt", help="punto de montaje temporal")
    p.add_argument("--www", default="/opt/litomask/www", help="carpeta con la app estática (index.html)")
    p.add_argument(
        "--dev",
        metavar="DIR",
        help="modo desarrollo: guarda en DIR como carpeta normal, sin gadget ni root",
    )
    p.add_argument("--label", default="LITOMASK", help="etiqueta del volumen que se informa (LITOMASK)")
    p.add_argument(
        "--mount-options",
        default="loop,sync",
        help="opciones de mount para la imagen (loop,sync); usa 'loop' si la escritura es muy lenta",
    )
    p.add_argument("--verbose", action="store_true", help="muestra cada comando ejecutado")
    return p


def serve(args: argparse.Namespace) -> int:
    logging.basicConfig(
        stream=sys.stdout,
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    storage: Storage
    if args.dev:
        storage = DevStorage(args.dev, args.label)
    else:
        storage = GadgetStorage(args.image, args.mount, args.label, args.mount_options)
    storage.startup()

    Handler.storage = storage
    Handler.www = os.path.abspath(args.www) if args.www else None
    if Handler.www and not os.path.isfile(os.path.join(Handler.www, "index.html")):
        log.warning("no hay index.html en %s: solo estará disponible la API", Handler.www)

    server = make_server(args.bind, args.port)
    log.info(
        "%s %s escuchando en http://%s:%d/ (modo %s)",
        SERVICE_NAME,
        SERVICE_VERSION,
        args.bind or "0.0.0.0",
        args.port,
        storage.mode,
    )

    stop = threading.Event()

    def on_signal(signum: int, _frame: Any) -> None:
        log.info("señal %s recibida: cerrando", signal.Signals(signum).name)
        stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    with contextlib.suppress(AttributeError):
        signal.signal(signal.SIGHUP, on_signal)

    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.5}, daemon=True)
    worker.start()
    try:
        while not stop.is_set():
            stop.wait(1.0)
    finally:
        server.shutdown()
        server.server_close()
        storage.shutdown()
        log.info("servicio detenido; memoria expuesta=%s", storage.is_exported())
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return serve(args)
    except OSError as e:
        print(f"{SERVICE_NAME}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
