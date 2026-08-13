#!/usr/bin/env bash
set -euo pipefail

: "${FRONTEND_BASE:=http://127.0.0.1:5173}"
: "${CDP_PORT:=9347}"
: "${CHROMIUM_BIN:=chromium-browser}"
: "${REPORT_PATH:=/tmp/nodeaccess-session-playback-cdp.json}"

profile_dir="$(mktemp -d /tmp/nodeaccess-playback-cdp.XXXXXX)"
chromium_log="$(mktemp /tmp/nodeaccess-playback-chromium.XXXXXX.log)"
chromium_pid=''

cleanup() {
  [[ -n "$chromium_pid" ]] && kill "$chromium_pid" 2>/dev/null || true
  rm -rf "$profile_dir"
  rm -f "$chromium_log"
}
trap cleanup EXIT

"$CHROMIUM_BIN" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port="$CDP_PORT" --user-data-dir="$profile_dir" \
  --window-size=1440,1000 about:blank >"$chromium_log" 2>&1 &
chromium_pid="$!"

for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1 && break
  kill -0 "$chromium_pid" 2>/dev/null || { sed -n '1,80p' "$chromium_log" >&2; exit 1; }
  sleep 0.1
done
curl -fsS "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null

FRONTEND_BASE="$FRONTEND_BASE" CDP_BASE="http://127.0.0.1:${CDP_PORT}" REPORT_PATH="$REPORT_PATH" \
  node tools/frontend/session-playback-cdp-flow.cjs
