#!/usr/bin/env bash
# One camera-bench run against the local dev server (pnpm dev on :5173).
# Launches Windows Chrome from WSL, waits for the result file written by
# bench-collector.mjs, then kills the Chrome process tree.
#
# Prerequisites (three terminals / background jobs):
#   pnpm dev
#   node scripts/bench/bench-collector.mjs <resultsdir>
#
# Usage: run-bench.sh <path:pan|jump> <order:sse|hilbert|octree> <resultsdir> [timeout_s] [exactCull:0|1]
#
# Native Linux/Mac: set BENCH_CHROME to your Chrome binary and replace the
# PowerShell launch below with a plain background launch + kill by PID.
set -u
BPATH="$1"; ORDER="$2"; DIR="$3"; TIMEOUT="${4:-240}"; EXACT="${5:-1}"
CHROME="${BENCH_CHROME:-C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe}"
LAZ="${BENCH_LAZ:-https%3A%2F%2Fdata.lazstream.stream%2Flaz%2FMelbourne_2018.laz}"
URL="http://localhost:5173/?url=${LAZ}&order=${ORDER}&bench=${BPATH}&benchPost=8123&timing"
# exactCull is ON by default in the app; pass 0 to benchmark the legacy path.
SUFFIX="-x"
if [ "$EXACT" = "0" ]; then URL="${URL}&exactCull=0"; SUFFIX=""; fi
RESULT="${DIR}/result-${BPATH}-${ORDER}${SUFFIX}.json"
rm -f "$RESULT"

PROFILE="lazbench-${BPATH}-${ORDER}-$$"
PID=$(powershell.exe -NoProfile -Command "
  \$p = Start-Process -PassThru -FilePath '${CHROME}' -ArgumentList @(
    '--user-data-dir=' + \$env:TEMP + '\\${PROFILE}',
    '--no-first-run','--no-default-browser-check',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--window-size=1600,900','--window-position=40,40',
    '--new-window','${URL}'
  ); \$p.Id" | tr -d '\r\n ')
echo "[run] ${BPATH}/${ORDER} exactCull=${EXACT} chrome pid=${PID}"

ELAPSED=0
while [ ! -f "$RESULT" ] && [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  sleep 5; ELAPSED=$((ELAPSED+5))
done

taskkill.exe /F /PID "$PID" /T >/dev/null 2>&1
powershell.exe -NoProfile -Command "Remove-Item -Recurse -Force (\$env:TEMP + '\\${PROFILE}') -ErrorAction SilentlyContinue" >/dev/null 2>&1

if [ -f "$RESULT" ]; then
  echo "[run] DONE ${BPATH}/${ORDER}"
else
  echo "[run] TIMEOUT ${BPATH}/${ORDER} after ${TIMEOUT}s"
  exit 1
fi
