#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
FAKE_BIN="${TMP_ROOT}/bin"
FAKE_CURL="${FAKE_BIN}/curl"
ROLE_ENV_FILE="${TMP_ROOT}/agent.env"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN"

cat > "$FAKE_CURL" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

url="${@: -1}"
case "$url" in
  *api-ok*|*gateway-ok*|*frontend-ok*)
    printf '200'
    ;;
  *api-down*|*gateway-down*|*frontend-down*)
    printf '503'
    exit 22
    ;;
  *)
    printf '000'
    exit 7
    ;;
esac
EOF

chmod +x "$FAKE_CURL"
printf 'NODEACCESS_HA_NODE_ROLE=PRIMARY\n' > "$ROLE_ENV_FILE"

PATH="$FAKE_BIN:$PATH" \
  ROLE_ENV_FILE="$ROLE_ENV_FILE" \
  API_HEALTH_URL=http://api-ok \
  GATEWAY_HEALTH_URL=http://gateway-ok \
  FRONTEND_HEALTH_URL=http://frontend-ok \
  bash "${PROJECT_ROOT}/scripts/deploy/keepalived-health-check.sh"

PATH="$FAKE_BIN:$PATH" \
  ROLE_ENV_FILE="$ROLE_ENV_FILE" \
  API_HEALTH_URL=http://api-ok \
  GATEWAY_HEALTH_URL=http://gateway-down \
  FRONTEND_HEALTH_URL=http://frontend-ok \
  REQUIRE_GATEWAY_HEALTH=false \
  bash "${PROJECT_ROOT}/scripts/deploy/keepalived-health-check.sh"

set +e
PATH="$FAKE_BIN:$PATH" \
  ROLE_ENV_FILE="$ROLE_ENV_FILE" \
  API_HEALTH_URL=http://api-down \
  GATEWAY_HEALTH_URL=http://gateway-ok \
  FRONTEND_HEALTH_URL=http://frontend-ok \
  bash "${PROJECT_ROOT}/scripts/deploy/keepalived-health-check.sh" >/dev/null 2>&1
api_failed_exit=$?
set -e

if [[ "$api_failed_exit" -eq 0 ]]; then
  echo "Health check deveria falhar quando API esta indisponivel." >&2
  exit 1
fi

set +e
PATH="$FAKE_BIN:$PATH" \
  ROLE_ENV_FILE="$ROLE_ENV_FILE" \
  API_HEALTH_URL=http://api-ok \
  GATEWAY_HEALTH_URL=http://gateway-down \
  FRONTEND_HEALTH_URL=http://frontend-ok \
  bash "${PROJECT_ROOT}/scripts/deploy/keepalived-health-check.sh" >/dev/null 2>&1
gateway_failed_exit=$?
set -e

if [[ "$gateway_failed_exit" -eq 0 ]]; then
  echo "Health check deveria falhar quando gateway obrigatorio esta indisponivel." >&2
  exit 1
fi

set +e
PATH="$FAKE_BIN:$PATH" \
  ROLE_ENV_FILE="$ROLE_ENV_FILE" \
  API_HEALTH_URL=http://api-ok \
  GATEWAY_HEALTH_URL=http://gateway-ok \
  FRONTEND_HEALTH_URL=http://frontend-down \
  bash "${PROJECT_ROOT}/scripts/deploy/keepalived-health-check.sh" >/dev/null 2>&1
frontend_failed_exit=$?
set -e

if [[ "$frontend_failed_exit" -eq 0 ]]; then
  echo "Health check deveria falhar quando frontend obrigatorio esta indisponivel." >&2
  exit 1
fi

printf 'NODEACCESS_HA_NODE_ROLE=STANDBY\n' > "$ROLE_ENV_FILE"
set +e
PATH="$FAKE_BIN:$PATH" \
  ROLE_ENV_FILE="$ROLE_ENV_FILE" \
  API_HEALTH_URL=http://api-ok \
  GATEWAY_HEALTH_URL=http://gateway-ok \
  FRONTEND_HEALTH_URL=http://frontend-ok \
  bash "${PROJECT_ROOT}/scripts/deploy/keepalived-health-check.sh" >/dev/null 2>&1
standby_exit=$?
set -e

if [[ "$standby_exit" -eq 0 ]]; then
  echo "Health check deveria impedir VIP em no STANDBY." >&2
  exit 1
fi

echo "[nodeaccess] Harness de health check Keepalived passou."
