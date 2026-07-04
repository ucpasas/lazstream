#!/usr/bin/env bash
# One ?gputiming=1 capture run against the local dev server (pnpm dev on :5173).
#
# Launches a fresh Windows Chrome from WSL with a CDP port, opens the viewer
# via the DevTools HTTP API, and streams the page's console (where the
# [gputiming] lines go) through scripts/bench/cdp-console.py running on
# Windows Python (the CDP port binds to Windows loopback — unreachable from
# WSL, so the collector must run Windows-side). Console capture via
# --enable-logging does NOT work: renderer-process console messages never
# reach chrome_debug.log / stderr in current Chrome.
#
# Prerequisites: pnpm dev running; Windows Python 3 on PATH (WindowsApps ok).
#
# Usage: run-gputiming.sh <label> <viewhash|default> <runtime_s> <resultsdir>
#   viewhash: a #v= token (see wiki [[View State Sharing]]); "default" loads
#             Melbourne via ?url= and the fitCameraToHeader overview.
#   SHOT=1   also captures a PNG screenshot at the end (shot-<label>.png).
#
# Analysis: scripts/bench/analyze-gputiming.py. IMPORTANT: the GPU sits in
# one of two perf states per browser launch (~2.7x apart; powerPreference is
# ignored on Windows). The fixed-size clear pass is the calibration canary —
# only compare runs whose clear-pass averages match (see the wiki
# [[Renderer Performance Roadmap]] Results section).
set -u
LABEL="$1"; VHASH="$2"; RUNTIME="$3"; DIR="$4"
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR"
PORT="${BENCH_CDP_PORT:-9224}"
PROFILE="lazgpt-run-${LABEL}"
CHROME_83='C:\PROGRA~1\Google\Chrome\Application\chrome.exe'

if [ "$VHASH" = "default" ]; then
  URL="http://localhost:5173/?gputiming=1${EXTRA:-}&url=https%3A%2F%2Fdata.lazstream.stream%2Flaz%2FMelbourne_2018.laz"
else
  URL="http://localhost:5173/?gputiming=1${EXTRA:-}#v=${VHASH}"
fi

# Make sure no stale run-profile chrome holds the port.
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*lazgpt-run-*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1
sleep 2

cd /mnt/c
cmd.exe /c "${CHROME_83} --user-data-dir=%TEMP%\\${PROFILE} --no-first-run --no-default-browser-check --remote-debugging-port=${PORT} --window-size=1600,900 --window-position=40,40 --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --new-window about:blank" >/dev/null 2>&1 &
sleep 6

WINTMP=$(powershell.exe -NoProfile -Command 'Write-Host $env:TEMP' | tr -d '\r\n')
cp "${SCRIPTDIR}/cdp-console.py" "$(wslpath "$WINTMP")/cdp_console.py"
if [ "${SHOT:-0}" = "1" ]; then
  powershell.exe -NoProfile -Command "python (\$env:TEMP + '\\cdp_console.py') ${PORT} '${URL}' ${RUNTIME} (\$env:TEMP + '\\lazshot-${LABEL}.png')" 2>&1 | tr -d '\r' > "$DIR/run-${LABEL}.log"
  cp "$(wslpath "$WINTMP")/lazshot-${LABEL}.png" "$DIR/shot-${LABEL}.png" 2>/dev/null
else
  powershell.exe -NoProfile -Command "python (\$env:TEMP + '\\cdp_console.py') ${PORT} '${URL}' ${RUNTIME}" 2>&1 | tr -d '\r' > "$DIR/run-${LABEL}.log"
fi

powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*${PROFILE}*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1
powershell.exe -NoProfile -Command "Remove-Item -Recurse -Force (\$env:TEMP + '\\${PROFILE}') -ErrorAction SilentlyContinue" >/dev/null 2>&1

N=$(grep -ac 'gputiming] clear' "$DIR/run-${LABEL}.log" 2>/dev/null)
echo "[run-gputiming] ${LABEL}: ${N} timing lines -> $DIR/run-${LABEL}.log"
