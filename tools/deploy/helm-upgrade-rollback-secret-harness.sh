#!/usr/bin/env bash
set -euo pipefail

: "${NODEACCESS_E2E_NAMESPACE:=nodeaccess-e2e}"
: "${NODEACCESS_E2E_RELEASE:=nodeaccess}"
: "${NODEACCESS_E2E_SECRET:=nodeaccess-runtime}"
: "${NODEACCESS_E2E_IMAGE_TAG:?NODEACCESS_E2E_IMAGE_TAG is required}"

KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
HELM_BIN="${HELM_BIN:-helm}"
CHART_PATH="${CHART_PATH:-charts/nodeaccess}"
deployment="${NODEACCESS_E2E_RELEASE}-nodeaccess-api"
baseline_revision="$($HELM_BIN history "$NODEACCESS_E2E_RELEASE" -n "$NODEACCESS_E2E_NAMESPACE" -o json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const h=JSON.parse(s);process.stdout.write(String(h[h.length-1].revision))})")"
baseline_replicas="$($KUBECTL_BIN get deployment "$deployment" -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.spec.replicas}')"
original_jwt="$($KUBECTL_BIN get secret "$NODEACCESS_E2E_SECRET" -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.data.JWT_SECRET}')"

common_values=(
  --set "existingSecret=${NODEACCESS_E2E_SECRET}"
  --set "image.tag=${NODEACCESS_E2E_IMAGE_TAG}"
  --set image.pullPolicy=IfNotPresent
)

$HELM_BIN upgrade "$NODEACCESS_E2E_RELEASE" "$CHART_PATH" -n "$NODEACCESS_E2E_NAMESPACE" \
  --reuse-values "${common_values[@]}" --set api.replicas=1 --wait --timeout 5m
[[ "$($KUBECTL_BIN get deployment "$deployment" -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.spec.replicas}')" == "1" ]]

$HELM_BIN rollback "$NODEACCESS_E2E_RELEASE" "$baseline_revision" -n "$NODEACCESS_E2E_NAMESPACE" --wait --timeout 5m
[[ "$($KUBECTL_BIN get deployment "$deployment" -n "$NODEACCESS_E2E_NAMESPACE" -o jsonpath='{.spec.replicas}')" == "$baseline_replicas" ]]

rotated_jwt="$(printf 'nodeaccess-rotated-jwt-secret-with-more-than-32-characters-%s-%s' "$RANDOM" "$RANDOM" | base64 | tr -d '\n')"
$KUBECTL_BIN patch secret "$NODEACCESS_E2E_SECRET" -n "$NODEACCESS_E2E_NAMESPACE" --type=merge \
  -p "{\"data\":{\"JWT_SECRET\":\"${rotated_jwt}\"}}"
$KUBECTL_BIN rollout restart deployment/"$deployment" -n "$NODEACCESS_E2E_NAMESPACE"
$KUBECTL_BIN rollout status deployment/"$deployment" -n "$NODEACCESS_E2E_NAMESPACE" --timeout=180s

$KUBECTL_BIN patch secret "$NODEACCESS_E2E_SECRET" -n "$NODEACCESS_E2E_NAMESPACE" --type=merge \
  -p "{\"data\":{\"JWT_SECRET\":\"${original_jwt}\"}}"
$KUBECTL_BIN rollout restart deployment/"$deployment" -n "$NODEACCESS_E2E_NAMESPACE"
$KUBECTL_BIN rollout status deployment/"$deployment" -n "$NODEACCESS_E2E_NAMESPACE" --timeout=180s

echo '{"upgrade":true,"rollback":true,"secretRotation":true,"secretRecovery":true}'
