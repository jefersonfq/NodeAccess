#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

stop_requested=0
child_pid=''
on_stop() {
  stop_requested=1
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null || true
  fi
}
trap on_stop TERM INT

npx wait-on tcp:3000 || exit $?

restart_count=0
while [ "$stop_requested" -eq 0 ]; do
  npm run dev -w apps/frontend &
  child_pid=$!
  wait "$child_pid"
  status=$?
  child_pid=''

  if [ "$stop_requested" -ne 0 ]; then
    exit 0
  fi
  if [ "$status" -ne 143 ] || [ "$restart_count" -ge 3 ]; then
    exit "$status"
  fi

  restart_count=$((restart_count + 1))
  echo "[frontend-dev] Vite recebeu SIGTERM (143). Reiniciando ($restart_count/3)..."
  sleep 1
done
