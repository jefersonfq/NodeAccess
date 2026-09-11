#!/usr/bin/env bash
set -euo pipefail

# Certifica um host SSH real somente quando solicitado. Não integra o caminho
# de conexão do usuário e não executa polling ou diagnóstico em produção.
: "${HOST_ID:?Defina HOST_ID para um host SSH descartável de teste}"

frontend_base="${FRONTEND_BASE:-http://127.0.0.1:5173}"
cdp_base="${CDP_BASE:-http://127.0.0.1:9360}"
report_dir="${REPORT_DIR:-/tmp/nodeaccess-terminal-pty-real}"
mkdir -p "$report_dir"

run_case() {
  local command="$1"
  local slug="$2"
  FRONTEND_BASE="$frontend_base" \
  CDP_BASE="$cdp_base" \
  HOST_ID="$HOST_ID" \
  RUN_COMMANDS=1 \
  RUN_HTOP=1 \
  INTERACTIVE_COMMAND="$command" \
  REPORT_PATH="$report_dir/$slug.json" \
  node tools/frontend/terminal-cdp-real-flow.cjs
}

run_case "top" "top"
run_case "htop" "htop"

echo "Certificação PTY real concluída em $report_dir"
