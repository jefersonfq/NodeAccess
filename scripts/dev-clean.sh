#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PORT_PATTERN=':(3000|3001|5173)\b'

find_nodeaccess_dev_pids() {
  ps -eo pid=,cmd= | while read -r pid cmd; do
    if [[ "$cmd" != *"$ROOT"* ]]; then
      continue
    fi
    case "$cmd" in
      *"/node_modules/.bin/concurrently"*|*"/node_modules/.bin/tsx"*|*"/node_modules/.bin/vite"*|*"npm run dev -w apps/backend"*|*"npm run dev:gateway -w apps/backend"*|*"npm run dev -w apps/frontend"*|*"wait-on tcp:3000"*)
        printf '%s\n' "$pid"
        ;;
    esac
  done | sort -u
}

find_nodeaccess_port_pids() {
  if ! command -v ss >/dev/null 2>&1; then
    return 0
  fi

  ss -ltnp 2>/dev/null \
    | grep -E "$PORT_PATTERN" \
    | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
    | while read -r pid; do
      cmd="$(ps -p "$pid" -o cmd= 2>/dev/null || true)"
      if [[ "$cmd" == *"$ROOT"* ]]; then
        printf '%s\n' "$pid"
      fi
    done | sort -u
}

kill_pids() {
  local signal="$1"
  shift
  if [ "$#" -eq 0 ]; then
    return 0
  fi
  kill "-$signal" "$@" 2>/dev/null || true
}

collect_pids() {
  {
    find_nodeaccess_dev_pids
    find_nodeaccess_port_pids
  } | sort -u
}

mapfile -t pids < <(collect_pids)

if [ "${#pids[@]}" -gt 0 ]; then
  echo "[dev-clean] Encerrando processos NodeAccess dev: ${pids[*]}"
  kill_pids TERM "${pids[@]}"
  sleep 1

  mapfile -t pids < <(collect_pids)
  if [ "${#pids[@]}" -gt 0 ]; then
    echo "[dev-clean] Forcando encerramento dos processos restantes: ${pids[*]}"
    kill_pids KILL "${pids[@]}"
    sleep 1
  fi
else
  echo "[dev-clean] Nenhum processo NodeAccess dev antigo encontrado."
fi

if command -v ss >/dev/null 2>&1; then
  remaining_ports="$(ss -ltnp 2>/dev/null | grep -E "$PORT_PATTERN" || true)"
  if [ -n "$remaining_ports" ]; then
    echo "[dev-clean] Portas 3000/3001/5173 ainda ocupadas por outro processo:"
    echo "$remaining_ports"
    exit 1
  fi
fi

echo "[dev-clean] Ambiente dev limpo."
