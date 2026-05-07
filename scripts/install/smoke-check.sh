#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
APP_URL_OVERRIDE="${APP_URL_OVERRIDE:-}"
API_HEALTH_PATH="${API_HEALTH_PATH:-/health}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:3001/health}"
SMOKE_CHECK_INSECURE="${SMOKE_CHECK_INSECURE:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl nao encontrado no PATH" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

APP_BASE_URL="${APP_URL_OVERRIDE:-${APP_URL:-}}"
if [[ -z "$APP_BASE_URL" ]]; then
  echo "APP_URL nao definido e APP_URL_OVERRIDE ausente." >&2
  exit 1
fi

APP_BASE_URL="${APP_BASE_URL%/}"
API_HEALTH_URL="${API_HEALTH_URL:-${APP_BASE_URL}${API_HEALTH_PATH}}"

CURL_TLS_ARGS=()
if [[ "${SMOKE_CHECK_INSECURE}" == "true" ]]; then
  CURL_TLS_ARGS=(-k)
  echo "[nodeaccess] Aviso: smoke check da API executara curl -k por SMOKE_CHECK_INSECURE=true."
elif [[ "${TLS_MODE:-}" == "selfsigned" && "$API_HEALTH_URL" =~ ^https:// ]]; then
  CURL_TLS_ARGS=(-k)
  echo "[nodeaccess] Aviso: TLS_MODE=selfsigned detectado; smoke check da API ignorara validacao da CA com curl -k."
fi

echo "[nodeaccess] Verificando health da API: ${API_HEALTH_URL}"
API_RESPONSE="$(curl -fsS "${CURL_TLS_ARGS[@]}" "$API_HEALTH_URL")"
echo "$API_RESPONSE" | grep -q '"status":"ok"'

echo "[nodeaccess] Verificando health do gateway: ${GATEWAY_HEALTH_URL}"
GATEWAY_RESPONSE="$(curl -fsS "$GATEWAY_HEALTH_URL")"
echo "$GATEWAY_RESPONSE" | grep -q '"status":"ok"'

echo "[nodeaccess] Smoke check concluido com sucesso."
echo "- api_health_url: ${API_HEALTH_URL}"
echo "- gateway_health_url: ${GATEWAY_HEALTH_URL}"
if [[ "${#CURL_TLS_ARGS[@]}" -gt 0 ]]; then
  echo "- tls_verification: skipped_for_smoke_check"
else
  echo "- tls_verification: enabled"
fi
