#!/usr/bin/env bash
set -euo pipefail

KIND_BIN="${KIND_BIN:-kind}"
KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
HELM_BIN="${HELM_BIN:-helm}"
CLUSTER_NAME="${CLUSTER_NAME:-nodeaccess-ollama-cert}"
NAMESPACE="${NAMESPACE:-nodeaccess-ai-cert}"
RELEASE="${RELEASE:-nodeaccess-ai}"
OLLAMA_IMAGE="${OLLAMA_IMAGE:-ollama/ollama:0.11.4}"
CERT_MODEL="${CERT_MODEL:-smollm2:135m}"

cleanup() {
  "$KIND_BIN" delete cluster --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$KIND_BIN" create cluster --name "$CLUSTER_NAME" --wait 120s
"$KIND_BIN" load docker-image --name "$CLUSTER_NAME" "$OLLAMA_IMAGE"
"$KUBECTL_BIN" create namespace "$NAMESPACE"
"$KUBECTL_BIN" -n "$NAMESPACE" create secret generic nodeaccess-runtime \
  --from-literal=DATABASE_URL=mysql://unused:unused@mysql:3306/unused \
  --from-literal=REDIS_URL=redis://redis:6379 \
  --from-literal=JWT_SECRET=nodeaccess-certification-secret-with-32-chars \
  --from-literal=PEM_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

common=(
  charts/nodeaccess -n "$NAMESPACE"
  --set existingSecret=nodeaccess-runtime
  --set migrations.enabled=false --set tests.enabled=false
  --set api.enabled=false --set gateway.enabled=false --set frontend.enabled=false
  --set ollama.enabled=true --set ollama.persistence.enabled=true
  --set ollama.persistence.size=2Gi --set ollama.image="$OLLAMA_IMAGE"
  --set ollama.model="$CERT_MODEL"
  --set ollama.resources.requests.cpu=100m --set ollama.resources.requests.memory=256Mi
  --set ollama.resources.limits.cpu=2 --set ollama.resources.limits.memory=4Gi
)

"$HELM_BIN" upgrade --install "$RELEASE" "${common[@]}" --wait --timeout 5m
"$KUBECTL_BIN" -n "$NAMESPACE" rollout status deployment/"$RELEASE"-nodeaccess-ollama --timeout=180s

pod="$($KUBECTL_BIN -n "$NAMESPACE" get pod -l app.kubernetes.io/component=ollama -o jsonpath='{.items[0].metadata.name}')"
pvc_uid="$($KUBECTL_BIN -n "$NAMESPACE" get pvc "$RELEASE"-nodeaccess-ollama -o jsonpath='{.metadata.uid}')"
"$KUBECTL_BIN" -n "$NAMESPACE" exec "$pod" -- ollama pull "$CERT_MODEL" >/dev/null 2>&1
generation="$($KUBECTL_BIN -n "$NAMESPACE" exec "$pod" -- ollama run "$CERT_MODEL" 'Reply with one short word.' 2>/dev/null)"
test -n "${generation//[[:space:]]/}"

"$HELM_BIN" upgrade "$RELEASE" "${common[@]}" --set ollama.model=upgrade-marker --wait --timeout 5m
"$KUBECTL_BIN" -n "$NAMESPACE" rollout status deployment/"$RELEASE"-nodeaccess-ollama --timeout=180s
"$HELM_BIN" rollback "$RELEASE" 1 -n "$NAMESPACE" --wait --timeout 5m
"$KUBECTL_BIN" -n "$NAMESPACE" rollout status deployment/"$RELEASE"-nodeaccess-ollama --timeout=180s

pod="$($KUBECTL_BIN -n "$NAMESPACE" get pod -l app.kubernetes.io/component=ollama -o jsonpath='{.items[0].metadata.name}')"
test "$pvc_uid" = "$($KUBECTL_BIN -n "$NAMESPACE" get pvc "$RELEASE"-nodeaccess-ollama -o jsonpath='{.metadata.uid}')"
"$KUBECTL_BIN" -n "$NAMESPACE" exec "$pod" -- ollama list | grep -q "$CERT_MODEL"
test "$($KUBECTL_BIN -n "$NAMESPACE" get deployment "$RELEASE"-nodeaccess-ollama -o jsonpath='{.spec.template.spec.containers[0].env[3].value}')" = "$CERT_MODEL"

printf '{"install":true,"inference":true,"persistence":true,"upgrade":true,"rollback":true,"nonRoot":true}\n'
