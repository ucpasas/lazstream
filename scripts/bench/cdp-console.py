"""Minimal CDP console collector (stdlib only — runs on Windows Python).

Usage: python cdp_console.py <cdp_port> <page_url> <runtime_seconds>

Opens <page_url> in a new tab via the DevTools HTTP API, attaches over a
hand-rolled WebSocket client, enables Runtime, and prints every
console API call as a line:  [<type>] <joined args>
Exits after <runtime_seconds>.
"""
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PORT = int(sys.argv[1])
PAGE_URL = sys.argv[2]
RUNTIME_S = float(sys.argv[3])


def http_json(path, method="GET"):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


# --- open the page in a new tab ---------------------------------------------
from urllib.parse import quote

tab = http_json("/json/new?" + quote(PAGE_URL, safe=""), method="PUT")
ws_url = tab["webSocketDebuggerUrl"]
print(f"[cdp] tab {tab['id']} -> {PAGE_URL}", flush=True)

# --- WebSocket client ---------------------------------------------------------
host = "127.0.0.1"
path = ws_url.split(f":{PORT}")[1]

sock = socket.create_connection((host, PORT), timeout=10)
key = base64.b64encode(os.urandom(16)).decode()
handshake = (
    f"GET {path} HTTP/1.1\r\n"
    f"Host: {host}:{PORT}\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\n"
    "Sec-WebSocket-Version: 13\r\n\r\n"
)
sock.sendall(handshake.encode())
resp = b""
while b"\r\n\r\n" not in resp:
    chunk = sock.recv(4096)
    if not chunk:
        raise RuntimeError("handshake failed: connection closed")
    resp += chunk
if b" 101 " not in resp.split(b"\r\n", 1)[0]:
    raise RuntimeError("handshake failed: " + resp.decode(errors="replace")[:200])
# Anything after the headers is the start of the first frame.
buf = bytearray(resp.split(b"\r\n\r\n", 1)[1])


def send_frame(payload: bytes, opcode=0x1):
    mask = os.urandom(4)
    n = len(payload)
    if n < 126:
        header = struct.pack("!BB", 0x80 | opcode, 0x80 | n)
    elif n < 65536:
        header = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, n)
    else:
        header = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, n)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(header + mask + masked)


def need(n):
    while len(buf) < n:
        chunk = sock.recv(65536)
        if not chunk:
            raise ConnectionError("closed")
        buf.extend(chunk)


def read_frame():
    """Returns (opcode, fin, payload)."""
    need(2)
    b0, b1 = buf[0], buf[1]
    fin = bool(b0 & 0x80)
    opcode = b0 & 0x0F
    ln = b1 & 0x7F
    off = 2
    if ln == 126:
        need(4)
        ln = struct.unpack("!H", bytes(buf[2:4]))[0]
        off = 4
    elif ln == 127:
        need(10)
        ln = struct.unpack("!Q", bytes(buf[2:10]))[0]
        off = 10
    # server->client frames are unmasked
    need(off + ln)
    payload = bytes(buf[off:off + ln])
    del buf[:off + ln]
    return opcode, fin, payload


def send_cmd(msg_id, method, params=None):
    send_frame(json.dumps({"id": msg_id, "method": method, "params": params or {}}).encode())


send_cmd(1, "Runtime.enable")
send_cmd(2, "Log.enable")

deadline = time.monotonic() + RUNTIME_S
sock.settimeout(2.0)
fragments = []

while time.monotonic() < deadline:
    try:
        opcode, fin, payload = read_frame()
    except (socket.timeout, TimeoutError):
        continue
    except ConnectionError:
        print("[cdp] connection closed", flush=True)
        break
    if opcode == 0x9:  # ping -> pong
        send_frame(payload, opcode=0xA)
        continue
    if opcode == 0x8:  # close
        print("[cdp] close frame", flush=True)
        break
    if opcode in (0x1, 0x0):
        fragments.append(payload)
        if not fin:
            continue
        data = b"".join(fragments)
        fragments = []
        try:
            msg = json.loads(data)
        except Exception:
            continue
        m = msg.get("method")
        if m == "Runtime.consoleAPICalled":
            p = msg["params"]
            parts = []
            for a in p.get("args", []):
                if "value" in a:
                    parts.append(str(a["value"]))
                elif "description" in a:
                    parts.append(a["description"])
                else:
                    parts.append(a.get("type", "?"))
            print(f"[{p.get('type','log')}] " + " ".join(parts), flush=True)
        elif m == "Runtime.exceptionThrown":
            d = msg["params"]["exceptionDetails"]
            print(f"[exception] {d.get('text','')} {json.dumps(d.get('exception',{}))[:300]}", flush=True)
        elif m == "Log.entryAdded":
            e = msg["params"]["entry"]
            print(f"[log:{e.get('level')}] {e.get('text','')[:400]}", flush=True)

# Optional 4th arg: path to save a PNG screenshot of the page at the end.
if len(sys.argv) > 4:
    send_cmd(98, "Page.enable")
    send_cmd(100, "Page.captureScreenshot", {"format": "png"})
    shot_deadline = time.monotonic() + 10
    frags = []
    while time.monotonic() < shot_deadline:
        try:
            opcode, fin, payload = read_frame()
        except (socket.timeout, TimeoutError, ConnectionError):
            break
        if opcode == 0x9:
            send_frame(payload, opcode=0xA)
            continue
        if opcode in (0x1, 0x0):
            frags.append(payload)
            if not fin:
                continue
            whole = b"".join(frags)
            frags = []
            try:
                msg = json.loads(whole)
            except Exception:
                continue
            if msg.get("id") == 100:
                data = msg.get("result", {}).get("data")
                if data:
                    with open(sys.argv[4], "wb") as f:
                        f.write(base64.b64decode(data))
                    print(f"[cdp] screenshot -> {sys.argv[4]}", flush=True)
                break

# Dump the UI warning/status elements (per-tile errors surface there, not in console).
send_cmd(99, "Runtime.evaluate", {
    "expression": "(document.getElementById('warning')?.textContent||'') + ' ||status|| ' + (document.getElementById('status')?.textContent||'')",
    "returnByValue": True,
})
end2 = time.monotonic() + 3
while time.monotonic() < end2:
    try:
        opcode, fin, payload = read_frame()
    except (socket.timeout, TimeoutError, ConnectionError):
        break
    if opcode in (0x1, 0x0) and fin:
        try:
            msg = json.loads(payload)
        except Exception:
            continue
        if msg.get("id") == 99:
            print("[ui] " + str(msg.get("result", {}).get("result", {}).get("value")), flush=True)
            break

print("[cdp] done", flush=True)
