#!/usr/bin/env bash
set -euo pipefail

: "${FRONTEND_BASE:=http://127.0.0.1:5173}"
: "${CDP_PORT:=9364}"
if [[ -z "${CHROMIUM_BIN:-}" ]]; then
  CHROMIUM_BIN="$(node -e "process.stdout.write(require('playwright').chromium.executablePath())")"
fi

profile_dir="$(mktemp -d /tmp/nodeaccess-agents-cdp.XXXXXX)"
chromium_log="$(mktemp /tmp/nodeaccess-agents-chromium.XXXXXX.log)"
chromium_pid=''

cleanup() {
  local exit_code=$?
  local cleanup_failed=0
  local profile_removed=0
  local cleanup_error=''
  local attempt
  trap - EXIT

  if [[ -n "$chromium_pid" ]]; then
    kill "$chromium_pid" 2>/dev/null || true
    # Reap our browser before deleting its profile. Bound shutdown if it stalls.
    for ((attempt = 0; attempt < 50; attempt++)); do
      kill -0 "$chromium_pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$chromium_pid" 2>/dev/null; then
      kill -KILL "$chromium_pid" 2>/dev/null || true
    fi
    wait "$chromium_pid" 2>/dev/null || true
  fi

  # Browser subprocesses may finish their final profile writes after the parent.
  for ((attempt = 0; attempt < 20; attempt++)); do
    if cleanup_error="$(rm -rf -- "$profile_dir" 2>&1)"; then
      profile_removed=1
      break
    fi
    sleep 0.1
  done
  if [[ "$profile_removed" -eq 0 ]]; then
    echo "[agents-cdp] Failed to remove browser profile: $profile_dir" >&2
    printf '%s\n' "$cleanup_error" >&2
    cleanup_failed=1
  fi
  if ! rm -f -- "$chromium_log"; then
    cleanup_failed=1
  fi
  # Cleanup must neither mask test failures nor silently pass a cleanup failure.
  if [[ "$exit_code" -eq 0 && "$cleanup_failed" -ne 0 ]]; then
    exit_code=1
  fi
  exit "$exit_code"
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

FRONTEND_BASE="$FRONTEND_BASE" CHROMIUM_CDP_URL="http://127.0.0.1:${CDP_PORT}" \
  node tools/frontend/agents-experience-playwright.cjs
