#!/usr/bin/env python3
"""Parse ?gputiming=1 run logs (run-gputiming.sh) and compare variants.

Usage:
  analyze-gputiming.py <resultsdir>                    # summary of v{1,2,3}-{earlyz,baseline} labels
  analyze-gputiming.py <resultsdir> <labelA> <labelB>  # pairwise compare with clear-pass canary

Only trust pairs whose clear-pass canary ratio is ~1.0 — the GPU perf state
varies ~2.7x per browser launch (see wiki Renderer Performance Roadmap).

Lines look like:
[log] [gputiming] clear 0.40/0.90  depth 20.28/23.21  resolve 0.22/0.51  total 20.90/23.75 ms (avg/max over 60 frames) - 342 slots, 17.06M pts, 12 B/pt
"""
import re
import sys
from pathlib import Path

DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')

RE = re.compile(
    r'gputiming\] clear (?P<clear>[\d.]+)/(?P<clearmax>[\d.]+)\s+'
    r'depth (?P<depth>[\d.]+)/(?P<depthmax>[\d.]+)\s+'
    r'resolve (?P<resolve>[\d.]+)/(?P<resolvemax>[\d.]+)\s+'
    r'total (?P<total>[\d.]+)/(?P<totalmax>[\d.]+) ms.*?(?P<slots>\d+) slots, (?P<mpts>[\d.]+)M pts'
)

def parse(label):
    rows = []
    f = DIR / f'run-{label}.log'
    if not f.exists():
        return rows
    for line in f.read_text(errors='replace').splitlines():
        m = RE.search(line)
        if m:
            rows.append({k: float(v) for k, v in m.groupdict().items()})
    return rows

def tail_summary(rows, n=15):
    t = rows[-n:]
    if not t:
        return None
    return {
        'lines': len(rows),
        'end_mpts': t[-1]['mpts'],
        'end_slots': int(t[-1]['slots']),
        'depth_avg': sum(r['depth'] for r in t) / len(t),
        'clear_avg': sum(r['clear'] for r in t) / len(t),
        'resolve_avg': sum(r['resolve'] for r in t) / len(t),
        'total_avg': sum(r['total'] for r in t) / len(t),
    }

def matched_compare(a, b, bucket=1.0):
    """Bucket rows by Mpts and compare depth avg where both variants have data."""
    def bucketize(rows):
        d = {}
        for r in rows:
            d.setdefault(round(r['mpts'] / bucket), []).append(r['depth'])
        return {k: sum(v) / len(v) for k, v in d.items()}
    ba, bb = bucketize(a), bucketize(b)
    common = sorted(set(ba) & set(bb))
    return [(k * bucket, ba[k], bb[k]) for k in common]

def compare(la, lb):
    a, b = parse(la), parse(lb)
    sa, sb = tail_summary(a), tail_summary(b)
    print(f'--- {la} vs {lb} ---')
    for name, s in ((la, sa), (lb, sb)):
        if s:
            print(f'  {name:12s} tail: depth {s["depth_avg"]:.2f} ms  clear {s["clear_avg"]:.3f}  '
                  f'@ {s["end_mpts"]:.1f}M pts / {s["end_slots"]} slots ({s["lines"]} lines)')
        else:
            print(f'  {name:12s} NO DATA')
            return
    canary = sa['clear_avg'] / sb['clear_avg'] if sb['clear_avg'] else float('nan')
    print(f'  clear-pass canary ratio: {canary:.2f} (should be ~1.0 for a fair pair)')
    pairs = matched_compare(a, b)
    if pairs:
        tail = pairs[-10:]
        rs = [x/y for _, x, y in tail if y]
        print(f'  matched-Mpts depth ratio (last 10 buckets): {sum(rs)/len(rs):.3f}  (<1 = first faster)')

if len(sys.argv) > 3:
    compare(sys.argv[2], sys.argv[3])
    sys.exit(0)

for vp in (1, 2, 3):
    ez = parse(f'v{vp}-earlyz')
    bl = parse(f'v{vp}-baseline')
    print(f'=== Viewpoint {vp} ===')
    for name, rows in (('earlyz', ez), ('baseline', bl)):
        s = tail_summary(rows)
        if s:
            print(f'  {name:9s} tail: depth {s["depth_avg"]:.2f} ms  clear {s["clear_avg"]:.2f}  '
                  f'resolve {s["resolve_avg"]:.2f}  total {s["total_avg"]:.2f} ms  '
                  f'@ {s["end_mpts"]:.1f}M pts / {s["end_slots"]} slots  ({s["lines"]} lines)')
        else:
            print(f'  {name:9s} NO DATA')
    if ez and bl:
        pairs = matched_compare(ez, bl)
        if pairs:
            print(f'  matched-Mpts depth comparison ({len(pairs)} buckets):')
            for mpts, d_ez, d_bl in pairs[-12:]:
                ratio = d_ez / d_bl if d_bl else float('nan')
                print(f'    {mpts:7.0f}M pts: earlyz {d_ez:6.2f} ms  baseline {d_bl:6.2f} ms  ratio {ratio:.3f}')
            rs = [ez_d / bl_d for _, ez_d, bl_d in pairs if bl_d]
            print(f'    mean ratio over all buckets: {sum(rs)/len(rs):.3f}  '
                  f'(<1 = early-z faster)')
    print()
