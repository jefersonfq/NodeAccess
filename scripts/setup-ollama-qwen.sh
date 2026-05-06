#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-qwen2.5-coder:3b}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Este script suporta Linux neste primeiro corte."
  exit 1
fi

run_as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_ollama_installed() {
  if command -v ollama >/dev/null 2>&1; then
    echo "Ollama ja instalado."
    return
  fi

  echo "Instalando Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
}

ensure_ollama_running() {
  if curl -fsS "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
    echo "Ollama ja esta respondendo em ${OLLAMA_URL}."
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^ollama\.service'; then
    echo "Habilitando servico do Ollama..."
    run_as_root systemctl enable --now ollama
  else
    echo "Iniciando Ollama em background..."
    nohup ollama serve >/tmp/ollama.log 2>&1 &
  fi

  echo "Aguardando Ollama subir..."
  for _ in $(seq 1 30); do
    if curl -fsS "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
      echo "Ollama pronto."
      return
    fi
    sleep 1
  done

  echo "O Ollama nao respondeu em ${OLLAMA_URL}."
  exit 1
}

pull_model() {
  echo "Baixando modelo ${MODEL}..."
  ollama pull "${MODEL}"
}

show_next_steps() {
  cat <<EOF

Configuracao sugerida no NodeAccess:
  Provider local: ollama
  Base URL local: ${OLLAMA_URL}
  Modelo local: ${MODEL}
  Politica: local_only
  Modo: read_only

Se o backend do NodeAccess estiver em Docker e o Ollama no host:
  Use uma URL acessivel pelo container, por exemplo:
  - http://host.docker.internal:11434
  - ou o IP/hostname do host

Teste manual do Ollama:
  curl ${OLLAMA_URL}/api/tags
  ollama run ${MODEL}
EOF
}

ensure_ollama_installed
ensure_ollama_running
pull_model
show_next_steps
