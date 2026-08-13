#!/usr/bin/env bash
set -euo pipefail

: "${NODEACCESS_E2E_NAMESPACE:=nodeaccess-e2e}"
: "${NODEACCESS_E2E_RELEASE:=nodeaccess}"
: "${NODEACCESS_E2E_SECRET:=nodeaccess-runtime}"
: "${NODEACCESS_E2E_IMAGE_TAG:?NODEACCESS_E2E_IMAGE_TAG is required}"

KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
HELM_BIN="${HELM_BIN:-helm}"
CHART_PATH="${CHART_PATH:-charts/nodeaccess}"
VALID_DATABASE_URL="${VALID_DATABASE_URL:?VALID_DATABASE_URL is required}"
INVALID_DATABASE_URL="mysql://nodeaccess:invalid@missing-mysql:3306/nodeaccess"

common_values=(
  --set "existingSecret=${NODEACCESS_E2E_SECRET}"
  --set "image.tag=${NODEACCESS_E2E_IMAGE_TAG}"
  --set image.pullPolicy=IfNotPresent
  --set gateway.replicas=1
)

baseline_generation="$($KUBECTL_BIN get deployment "${NODEACCESS_E2E_RELEASE}-nodeaccess-api" \
  -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.metadata.generation}')"
baseline_replicas="$($KUBECTL_BIN get deployment "${NODEACCESS_E2E_RELEASE}-nodeaccess-api" \
  -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.spec.replicas}')"

$KUBECTL_BIN patch secret "$NODEACCESS_E2E_SECRET" -n "$NODEACCESS_E2E_NAMESPACE" \
  --type=merge -p "{\"stringData\":{\"DATABASE_URL\":\"${INVALID_DATABASE_URL}\"}}"

if $HELM_BIN upgrade "$NODEACCESS_E2E_RELEASE" "$CHART_PATH" -n "$NODEACCESS_E2E_NAMESPACE" \
  --reuse-values "${common_values[@]}" --set api.replicas=2 --wait --timeout 90s; then
  echo "Expected migration failure, but Helm upgrade succeeded" >&2
  exit 1
fi

failed_generation="$($KUBECTL_BIN get deployment "${NODEACCESS_E2E_RELEASE}-nodeaccess-api" \
  -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.metadata.generation}')"
failed_replicas="$($KUBECTL_BIN get deployment "${NODEACCESS_E2E_RELEASE}-nodeaccess-api" \
  -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.spec.replicas}')"
if [[ "$failed_generation" != "$baseline_generation" || "$failed_replicas" != "$baseline_replicas" ]]; then
  echo "Failed migration changed the running API deployment" >&2
  exit 1
fi

$KUBECTL_BIN patch secret "$NODEACCESS_E2E_SECRET" -n "$NODEACCESS_E2E_NAMESPACE" \
  --type=merge -p "{\"stringData\":{\"DATABASE_URL\":\"${VALID_DATABASE_URL}\"}}"
$HELM_BIN upgrade "$NODEACCESS_E2E_RELEASE" "$CHART_PATH" -n "$NODEACCESS_E2E_NAMESPACE" \
  --reuse-values "${common_values[@]}" --set api.replicas=2 --wait --timeout 5m
$KUBECTL_BIN rollout status deployment/"${NODEACCESS_E2E_RELEASE}-nodeaccess-api" \
  -n "$NODEACCESS_E2E_NAMESPACE" --timeout=180s

ready_replicas="$($KUBECTL_BIN get deployment "${NODEACCESS_E2E_RELEASE}-nodeaccess-api" \
  -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.status.readyReplicas}')"
[[ "$ready_replicas" == "2" ]] || { echo "Recovered API does not have two ready replicas" >&2; exit 1; }

echo '{"migrationFailureBlockedRollout":true,"recoveryUpgradeSucceeded":true}'
