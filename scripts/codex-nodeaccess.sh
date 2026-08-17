#!/usr/bin/env bash

set -euo pipefail

readonly token_file="${NODEACCESS_MCP_TOKEN_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/nodeaccess/codex-mcp-token}"
readonly codex_bin="${CODEX_BIN:-codex}"

show_help() {
  cat <<'EOF'
Uso: ./scripts/codex-nodeaccess.sh [--setup-token] [argumentos do Codex]

  --setup-token  Solicita e salva um novo token antes de iniciar o Codex.
  --help         Mostra esta ajuda.

Se o arquivo de token estiver ausente ou vazio, o launcher solicita o token
automaticamente. O valor e armazenado com permissao 0600 e nunca e exibido.
EOF
}

save_new_token() {
  local new_token=''

  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    echo "Nao foi possivel abrir um terminal interativo para solicitar o token MCP." >&2
    echo "Execute este script diretamente em um terminal." >&2
    exit 1
  fi

  printf 'Cole o novo token MCP e pressione Enter: ' > /dev/tty
  IFS= read -r -s new_token < /dev/tty || true
  printf '\n' > /dev/tty
  new_token="${new_token%$'\r'}"

  if [[ -z "$new_token" ]]; then
    echo "Token MCP vazio. Nenhuma credencial foi alterada." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$token_file")"
  umask 077
  printf '%s\n' "$new_token" > "$token_file"
  chmod 600 "$token_file"
  unset new_token
  echo "Token MCP salvo com seguranca em: $token_file" >&2
}

if [[ "${1:-}" == '--help' ]]; then
  show_help
  exit 0
fi

if [[ "${1:-}" == '--setup-token' ]]; then
  shift
  unset NODEACCESS_MCP_TOKEN
  save_new_token
fi

NODEACCESS_MCP_TOKEN="${NODEACCESS_MCP_TOKEN:-}"
if [[ -z "$NODEACCESS_MCP_TOKEN" && -r "$token_file" ]]; then
  IFS= read -r NODEACCESS_MCP_TOKEN < "$token_file" || true
  NODEACCESS_MCP_TOKEN="${NODEACCESS_MCP_TOKEN%$'\r'}"
fi

if [[ -z "$NODEACCESS_MCP_TOKEN" ]]; then
  echo "Nenhum token MCP valido foi encontrado. Vamos configurar um agora." >&2
  save_new_token
  IFS= read -r NODEACCESS_MCP_TOKEN < "$token_file"
fi

export NODEACCESS_MCP_TOKEN
exec "$codex_bin" "$@"
