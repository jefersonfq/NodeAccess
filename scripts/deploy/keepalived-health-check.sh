#!/usr/bin/env bash
set -euo pipefail

# Health check para Keepalived/VRRP.
# Exit 0: no pode manter/assumir VIP.
# Exit 1: no deve perder prioridade.

API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:3001/health/ready}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-http://127.0.0.1/health/ready}"
CHECK_TIMEOUT_SECONDS="${CHECK_TIMEOUT_SECONDS:-3}"
REQUIRE_GATEWAY_HEALTH="${REQUIRE_GATEWAY_HEALTH:-true}"
REQUIRE_FRONTEND_HEALTH="${REQUIRE_FRONTEND_HEALTH:-true}"
CHECK_DOCKER="${CHECK_DOCKER:-false}"
ROLE_ENV_FILE="${ROLE_ENV_FILE:-/opt/nodeaccess-ha-agent/agent.env}"
REQUIRE_PRIMARY_ROLE="${REQUIRE_PRIMARY_ROLE:-true}"

if [[ "$REQUIRE_PRIMARY_ROLE" == "true" ]]; then
  if [[ ! -r "$ROLE_ENV_FILE" ]]; then
    echo "Papel HA nao pode ser confirmado; arquivo ausente: $ROLE_ENV_FILE" >&2
    exit 1
  fi
  # O arquivo e criado pelo instalador root-only e contém valores escapados.
  # Keepalived nunca deve publicar a VIP com papel ausente ou STANDBY.
  source "$ROLE_ENV_FILE"
  if [[ "${NODEACCESS_HA_NODE_ROLE:-}" != "PRIMARY" ]]; then
    echo "VIP bloqueada para papel ${NODEACCESS_HA_NODE_ROLE:-desconhecido}; esperado PRIMARY" >&2
    exit 1
  fi
fi

check_url() {
  local label="$1"
  local url="$2"
  local status_code

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl nao encontrado no PATH" >&2
    return 1
  fi

  # O frontend pode redirecionar o probe local HTTP para HTTPS. Seguimos apenas
  # essa cadeia local; --insecure evita falso negativo por SAN de 127.0.0.1 em
  # certificado de VIP, sem afetar os probes internos da API e do gateway.
  status_code="$(curl -kLfsS -m "$CHECK_TIMEOUT_SECONDS" -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  if [[ "$status_code" == "200" ]]; then
    return 0
  fi

  echo "${label} unhealthy (${status_code:-sem resposta}): ${url}" >&2
  return 1
}

if [[ "$CHECK_DOCKER" == "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker nao encontrado no PATH" >&2
    exit 1
  fi

  if ! docker ps >/dev/null 2>&1; then
    echo "Docker daemon indisponivel" >&2
    exit 1
  fi
fi

check_url "API ready" "$API_HEALTH_URL"

if [[ "$REQUIRE_GATEWAY_HEALTH" == "true" ]]; then
  check_url "Gateway ready" "$GATEWAY_HEALTH_URL"
fi

if [[ "$REQUIRE_FRONTEND_HEALTH" == "true" ]]; then
  check_url "Frontend ready" "$FRONTEND_HEALTH_URL"
fi

exit 0
