#!/usr/bin/env python3
"""Visualizer desktop app: the visualizer full screen in one window, all settings in another.

Both windows are WebKitGTK views of the built web app (dist/), served from a small local
HTTP server. The settings window drives the visualizer through a message bridge:
settings page -> this host -> visualizer page, and state flows back the same way.

Usage: visualizer.py [--dev URL] [--audio FILE] [--windowed]
  --dev URL     load the pages from a running Vite dev server instead of dist/
  --audio FILE  start with this track (default: $VISUALIZER_AUDIO, else the demo loop)
  --windowed    do not start full screen
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import secrets
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlencode

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("WebKit", "6.0")
from gi.repository import Adw, Gio, GLib, Gtk, WebKit  # noqa: E402

APP_ID = "com.marcus0035.Visualizer"
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
BRIDGE = "visualizer"

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/wasm", ".wasm")


class Files:
    """Files the user picked in a native dialog, reachable by the pages under a random token."""

    def __init__(self) -> None:
        self._paths: dict[str, Path] = {}
        self._lock = threading.Lock()

    def add(self, path: Path) -> str:
        token = secrets.token_hex(16)
        with self._lock:
            self._paths[token] = path
        return token

    def get(self, token: str) -> Path | None:
        with self._lock:
            return self._paths.get(token)


class Handler(SimpleHTTPRequestHandler):
    """Serves dist/ and, under /desktop-file/<token>, the files picked in the native dialog."""

    files: Files

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/desktop-file/"):
            return self._send_picked(self.path.removeprefix("/desktop-file/").split("?")[0])
        return super().do_GET()

    def _send_picked(self, token: str) -> None:
        path = self.files.get(token)
        if not path or not path.is_file():
            self.send_error(404)
            return
        size = path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(size))
        # The Vite dev server is another origin
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        with path.open("rb") as f:
            while chunk := f.read(1 << 20):
                self.wfile.write(chunk)


def start_server(files: Files) -> ThreadingHTTPServer:
    handler = partial(type("BoundHandler", (Handler,), {"files": files}), directory=str(DIST))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def js_call(view: WebKit.WebView, message: dict) -> None:
    """Deliver a message to a page's bridge (src/desktop/bridge.ts)."""
    payload = json.dumps(json.dumps(message))
    view.evaluate_javascript(f"window.__visualizer && window.__visualizer.receive({payload})", -1, None, None, None, None, None)


def make_view(session: WebKit.NetworkSession, on_message) -> WebKit.WebView:
    content = WebKit.UserContentManager()
    content.register_script_message_handler(BRIDGE, None)
    content.connect(f"script-message-received::{BRIDGE}", lambda _m, value: on_message(json.loads(value.to_string())))
    # Sound may start without a click (no start screen in the desktop app)
    policies = WebKit.WebsitePolicies(autoplay=WebKit.AutoplayPolicy.ALLOW)
    view = WebKit.WebView(network_session=session, user_content_manager=content, website_policies=policies)
    s = view.get_settings()
    s.set_enable_webgl(True)
    s.set_enable_webaudio(True)
    s.set_enable_media_stream(True)
    s.set_enable_mediasource(True)
    s.set_media_playback_requires_user_gesture(False)
    s.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.ALWAYS)
    s.set_enable_developer_extras(True)
    view.connect("permission-request", on_permission)
    view.set_vexpand(True)
    view.set_hexpand(True)
    return view


def on_permission(_view: WebKit.WebView, request: WebKit.PermissionRequest) -> bool:
    # Microphone / line-in / system sound monitor: the sound source the user picked
    if isinstance(request, WebKit.UserMediaPermissionRequest) and request.get_property("is-for-audio-device"):
        request.allow()
    elif isinstance(request, WebKit.DeviceInfoPermissionRequest):
        request.allow()
    else:
        request.deny()
    return True


class App(Adw.Application):
    def __init__(self, args: argparse.Namespace) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
        self.args = args
        self.files = Files()
        self.server: ThreadingHTTPServer | None = None
        self.main_win: Gtk.ApplicationWindow | None = None
        self.settings_win: Gtk.ApplicationWindow | None = None
        self.main_view: WebKit.WebView | None = None
        self.settings_view: WebKit.WebView | None = None
        self.settings_ready = False

    # Pages and URLs

    @property
    def base(self) -> str:
        return self.args.dev.rstrip("/") if self.args.dev else f"http://127.0.0.1:{self.server.server_port}"

    def file_url(self, path: Path) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/desktop-file/{self.files.add(path)}"

    def do_activate(self) -> None:
        if self.main_win:
            self.main_win.present()
            return
        if not self.args.dev and not (DIST / "index.html").is_file():
            print("dist/ is missing: run `npm run build` first (or pass --dev URL).", file=sys.stderr)
            self.quit()
            return
        self.server = start_server(self.files)
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.DEFAULT)

        # Own storage (settings, image, palettes), apart from any browser
        data = Path(GLib.get_user_data_dir()) / "visualizer"
        cache = Path(GLib.get_user_cache_dir()) / "visualizer"
        session = self.session = WebKit.NetworkSession.new(str(data), str(cache))
        session.connect("download-started", self.on_download)

        self.main_view = make_view(session, self.from_main)
        self.main_view.set_background_color(_rgba("#000000"))
        self.main_win = Gtk.ApplicationWindow(application=self, title="Visualizer", default_width=1280, default_height=720)
        self.main_win.set_child(self.main_view)
        self.main_win.connect("close-request", lambda _w: self.quit() or False)
        query = {}
        audio = self.args.audio or os.environ.get("VISUALIZER_AUDIO")
        if audio and Path(audio).expanduser().is_file():
            path = Path(audio).expanduser()
            query = {"audio": self.file_url(path), "name": path.name}
        if not self.args.windowed:
            self.main_win.fullscreen()
        self.main_win.present()
        self.main_view.load_uri(f"{self.base}/" + (f"?{urlencode(query, quote_via=quote)}" if query else ""))

        self.add_actions()

    def add_actions(self) -> None:
        def action(name: str, accels: list[str], fn) -> None:
            a = Gio.SimpleAction.new(name, None)
            a.connect("activate", lambda *_: fn())
            self.add_action(a)
            self.set_accels_for_action(f"app.{name}", accels)

        action("quit", ["<Control>q"], self.quit)
        action("close-settings", ["<Control>w"], self.close_active_settings)

    # Settings window

    def ensure_settings(self) -> Gtk.ApplicationWindow:
        if self.settings_win:
            return self.settings_win
        self.settings_view = make_view(self.session, self.from_settings)
        win = Gtk.ApplicationWindow(application=self, title="Visualizer settings", default_width=960, default_height=720)
        header = Gtk.HeaderBar()
        win.set_titlebar(header)
        win.set_child(self.settings_view)
        win.connect("close-request", self.on_settings_close)
        self.settings_view.load_uri(f"{self.base}/settings.html")
        self.settings_win = win
        return win

    def open_settings(self) -> None:
        win = self.ensure_settings()
        win.present()
        self.send_main({"type": "settingsVisible", "on": True})

    def on_settings_close(self, win: Gtk.Window) -> bool:
        win.set_visible(False)
        self.send_main({"type": "settingsVisible", "on": False})
        return True

    def close_active_settings(self) -> None:
        if self.settings_win and self.settings_win.is_active():
            self.on_settings_close(self.settings_win)

    # Bridge

    def send_main(self, msg: dict) -> None:
        if self.main_view:
            js_call(self.main_view, msg)

    def send_settings(self, msg: dict) -> None:
        if self.settings_view and self.settings_ready:
            js_call(self.settings_view, msg)

    def from_main(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "openSettings":
            self.open_settings()
        elif kind == "toggleFullscreen":
            if self.main_win.is_fullscreen():
                self.main_win.unfullscreen()
            else:
                self.main_win.fullscreen()
        else:
            self.send_settings(msg)

    def from_settings(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "ready":
            self.settings_ready = True
            self.send_main({"type": "hello"})
            self.send_main({"type": "settingsVisible", "on": True})
        elif kind == "pick":
            self.pick(msg.get("kind") == "image")
        else:
            self.send_main(msg)

    def pick(self, image: bool) -> None:
        filt = Gtk.FileFilter(name="Images" if image else "Audio")
        filt.add_mime_type("image/*" if image else "audio/*")
        store = Gio.ListStore.new(Gtk.FileFilter)
        store.append(filt)
        dialog = Gtk.FileDialog(title="Image" if image else "Audio file", filters=store, default_filter=filt)

        def done(d: Gtk.FileDialog, result: Gio.AsyncResult) -> None:
            try:
                f = d.open_finish(result)
            except GLib.Error:
                return  # cancelled
            path = Path(f.get_path())
            self.send_main({"type": "loadFile", "kind": "image" if image else "audio", "url": self.file_url(path), "name": path.name})

        dialog.open(self.settings_win, None, done)

    # Downloads (video export)

    def on_download(self, _session: WebKit.NetworkSession, download: WebKit.Download) -> None:
        def destination(d: WebKit.Download, name: str) -> bool:
            folder = Path(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS) or Path.home() / "Videos")
            folder.mkdir(parents=True, exist_ok=True)
            d.set_destination(str(_free_name(folder / Path(name).name)))
            return True

        download.connect("decide-destination", destination)


def _free_name(path: Path) -> Path:
    n = 1
    candidate = path
    while candidate.exists():
        n += 1
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
    return candidate


def _rgba(hex_color: str):
    gi.require_version("Gdk", "4.0")
    from gi.repository import Gdk

    c = Gdk.RGBA()
    c.parse(hex_color)
    return c


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dev", metavar="URL", help="load the pages from a Vite dev server")
    parser.add_argument("--audio", metavar="FILE", help="start with this track")
    parser.add_argument("--windowed", action="store_true", help="do not start full screen")
    args = parser.parse_args()
    return App(args).run([sys.argv[0]])


if __name__ == "__main__":
    sys.exit(main())
