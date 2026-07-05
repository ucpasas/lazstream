#!/usr/bin/env python3
"""Generate the three benchmark #v= viewpoint tokens from a LAZ header.

The Renderer Performance Roadmap benchmark protocol uses three fixed
viewpoints, pure functions of the file's header bbox (no manual camera
input), so any session can regenerate identical tokens:

  V1 close   — 400 m oblique (35 deg elevation, 45 deg azimuth) over the
               bbox centre: dense block filling the frame (overdraw).
  V2 medium  — same ray at 2.5 km: many chunks at tens-of-px coverage
               (over-coverage regime).
  V3 overview— fitCameraToHeader replica: full-tile view, distance =
               (diagonal/2)/tan(fovY/2)*1.1, 3D-centroid target.

Writes viewpoints.json next to this script and prints shell exports.

Usage: make-viewpoints.py [laz_url]
"""
import base64
import json
import math
import struct
import sys
import urllib.request
from pathlib import Path

URL = sys.argv[1] if len(sys.argv) > 1 else \
    'https://data.lazstream.stream/laz/Melbourne_2018.laz'

# The CDN 403s python's default UA; any browser-ish UA passes.
req = urllib.request.Request(
    URL, headers={'Range': 'bytes=0-374', 'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=30) as r:
    hdr = r.read()

# LAS header: bbox doubles at fixed offsets (maxX minX maxY minY maxZ minZ)
max_x, min_x, max_y, min_y, max_z, min_z = struct.unpack_from('<6d', hdr, 179)

cx, cy = (min_x + max_x) / 2, (min_y + max_y) / 2
dx, dy, dz = max_x - min_x, max_y - min_y, max_z - min_z
ground_z = min_z
FOVY = 60 * math.pi / 180
EL, AZ = 35 * math.pi / 180, 45 * math.pi / 180


def cam(target, dist):
    tx, ty, tz = target
    return {
        'x': tx + dist * math.cos(EL) * math.cos(AZ),
        'y': ty + dist * math.cos(EL) * math.sin(AZ),
        'z': tz + dist * math.sin(EL),
        'tx': tx, 'ty': ty, 'tz': tz,
        'fovY': FOVY,
    }


diagonal = max(math.sqrt(dx * dx + dy * dy + dz * dz), 1)
fit_dist = max((diagonal / 2) / math.tan(FOVY / 2) * 1.1, 1)

views = {
    'v1': cam((cx, cy, ground_z), 400),
    'v2': cam((cx, cy, ground_z), 2500),
    'v3': cam((cx, cy, (min_z + max_z) / 2), fit_dist),
}


def token(c):
    js = json.dumps({'source': URL, 'cam': c}, separators=(',', ':'))
    return base64.urlsafe_b64encode(js.encode()).decode().rstrip('=')


out = {
    'url': URL,
    'bbox': {'minX': min_x, 'maxX': max_x, 'minY': min_y,
             'maxY': max_y, 'minZ': min_z, 'maxZ': max_z},
    'tokens': {k: token(v) for k, v in views.items()},
    'cams': views,
}
dst = Path(__file__).parent / 'viewpoints.json'
dst.write_text(json.dumps(out, indent=2) + '\n')
print(f'bbox X {min_x:.1f}..{max_x:.1f}  Y {min_y:.1f}..{max_y:.1f}  '
      f'Z {min_z:.1f}..{max_z:.1f}', file=sys.stderr)
for k, t in out['tokens'].items():
    print(f'{k.upper()}={t}')
