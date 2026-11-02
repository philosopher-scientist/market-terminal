"""Loopback QA server. Production deliverable is market-terminal.html alone.

Run: python3 tests/verify-preview.py
/market-terminal.html serves the original file.
/provider-blocked.html adds CSP that blocks remote scripts/frames/connections,
so the real application can be checked for truthful provider failure states.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        preview_sizes = {"/responsive-mobile.html": (390, 720), "/responsive-tablet.html": (820, 900)}
        if self.path in preview_sizes:
            width, height = preview_sizes[self.path]
            content = (f'<!doctype html><html><head><title>Responsive QA {width}px</title>'
                       '<style>body{margin:0;background:#18202b;display:flex;justify-content:center}'
                       f'iframe{{border:0;width:{width}px;height:{height}px;flex:none}}</style></head>'
                       '<body><iframe id="responsive" title="Responsive test viewport" '
                       'src="/market-terminal.html" allowfullscreen></iframe></body></html>').encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        if self.path.split("?", 1)[0] == "/provider-blocked.html":
            content = (ROOT / "market-terminal.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Content-Security-Policy", "script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'")
            self.end_headers()
            self.wfile.write(content)
        else:
            super().do_GET()


if __name__ == "__main__":
    print("QA preview: http://127.0.0.1:8766/market-terminal.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
