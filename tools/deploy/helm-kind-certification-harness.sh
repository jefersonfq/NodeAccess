#!/usr/bin/env bash
set -euo pipefail

KIND_BIN="${KIND_BIN:-kind}"
KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
HELM_BIN="${HELM_BIN:-helm}"
CLUSTER_NAME="${CLUSTER_NAME:-nodeaccess-cert}"
NAMESPACE="${NODEACCESS_E2E_NAMESPACE:-nodeaccess-e2e}"
RELEASE="${NODEACCESS_E2E_RELEASE:-nodeaccess}"
IMAGE_REPOSITORY="${NODEACCESS_E2E_IMAGE_REPOSITORY:-nodeaccess-backend}"
IMAGE_TAG="${NODEACCESS_E2E_IMAGE_TAG:-kind-cert}"
IMAGE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
PROFILE_FILE="${PROFILE_FILE:-/tmp/nodeaccess-kind-profile.json}"
TLS_CERT="${TLS_CERT:-/tmp/nodeaccess-kind-tls.crt}"
TLS_KEY="${TLS_KEY:-/tmp/nodeaccess-kind-tls.key}"
DATABASE_URL="mysql://nodeaccess:nodeaccess-e2e-password@mysql:3306/nodeaccess"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_dir="$(mktemp -d /tmp/nodeaccess-kind-cert.XXXXXX)"
agent_dist_placeholder="$ROOT_DIR/apps/agent/dist/.kind-cert-placeholder"
build_context="$ROOT_DIR"
pids=()

cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  "$KIND_BIN" delete cluster --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
  rm -f "$agent_dist_placeholder"
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

start_port_forward() {
  local namespace="$1" resource="$2" mapping="$3" log_file="$4"
  "$KUBECTL_BIN" -n "$namespace" port-forward "$resource" "$mapping" >"$log_file" 2>&1 &
  local pid=$!
  for _ in $(seq 1 100); do
    grep -q 'Forwarding from' "$log_file" && { printf '%s\n' "$pid"; return; }
    kill -0 "$pid" 2>/dev/null || { cat "$log_file" >&2; return 1; }
    sleep 0.1
  done
  cat "$log_file" >&2
  return 1
}

stop_port_forward() {
  local pid="$1"
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

retry_external() {
  local attempt
  for attempt in 1 2 3; do
    "$@" && return 0
    [[ "$attempt" == 3 ]] && return 1
    echo "External download failed (attempt $attempt/3); retrying in 5 seconds" >&2
    sleep 5
  done
}

cd "$ROOT_DIR"
"$KIND_BIN" create cluster --name "$CLUSTER_NAME" --wait 120s
if [[ "${SKIP_IMAGE_BUILD:-false}" != "true" && ( "${STAGE_BUILD_CONTEXT:-auto}" == "true" || ( "${STAGE_BUILD_CONTEXT:-auto}" == "auto" && "$ROOT_DIR" == /mnt/* ) ) ]]; then
  build_context="$runtime_dir/build-context"
  mkdir -p "$build_context/apps" "$build_context/packages" "$build_context/scripts/deploy"
  rsync -rlt package.json package-lock.json tsconfig.base.json .dockerignore "$build_context/"
  rsync -rlt --exclude=node_modules --exclude=dist apps/backend "$build_context/apps/"
  rsync -rlt --exclude=node_modules packages/shared "$build_context/packages/"
  mkdir -p "$build_context/apps/agent/dist"
  touch "$build_context/apps/agent/dist/.kind-cert-placeholder"
  rsync -rlt scripts/deploy/install-ha-agent.sh scripts/deploy/nodeaccess-ha-privileged-helper.sh "$build_context/scripts/deploy/"
elif [[ "${SKIP_IMAGE_BUILD:-false}" != "true" ]]; then
  mkdir -p "$(dirname "$agent_dist_placeholder")"
  touch "$agent_dist_placeholder"
fi
if [[ "${SKIP_IMAGE_BUILD:-false}" != "true" ]]; then
  docker build -f "$ROOT_DIR/docker/backend.Dockerfile" --target prod --build-arg APP_VERSION=kind-cert -t "$IMAGE" "$build_context"
else
  docker image inspect "$IMAGE" >/dev/null
fi
docker pull mysql:8.0
docker pull redis:7-alpine
docker pull busybox:1.36
"$KIND_BIN" load docker-image --name "$CLUSTER_NAME" "$IMAGE" mysql:8.0 redis:7-alpine busybox:1.36

cat >"$runtime_dir/dependencies.yaml" <<YAML
apiVersion: v1
kind: Namespace
metadata: { name: $NAMESPACE }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: mysql, namespace: $NAMESPACE }
spec:
  replicas: 1
  selector: { matchLabels: { app: mysql } }
  template:
    metadata: { labels: { app: mysql } }
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          imagePullPolicy: IfNotPresent
          env:
            - { name: MYSQL_DATABASE, value: nodeaccess }
            - { name: MYSQL_USER, value: nodeaccess }
            - { name: MYSQL_PASSWORD, value: nodeaccess-e2e-password }
            - { name: MYSQL_ROOT_PASSWORD, value: nodeaccess-e2e-root }
          ports: [{ name: mysql, containerPort: 3306 }]
          readinessProbe:
            exec: { command: [mysqladmin, ping, -h, 127.0.0.1, -unodeaccess, -pnodeaccess-e2e-password] }
            initialDelaySeconds: 10
            periodSeconds: 3
---
apiVersion: v1
kind: Service
metadata: { name: mysql, namespace: $NAMESPACE }
spec: { selector: { app: mysql }, ports: [{ name: mysql, port: 3306, targetPort: mysql }] }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: redis, namespace: $NAMESPACE }
spec:
  replicas: 1
  selector: { matchLabels: { app: redis } }
  template:
    metadata: { labels: { app: redis } }
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          imagePullPolicy: IfNotPresent
          ports: [{ name: redis, containerPort: 6379 }]
          readinessProbe:
            exec: { command: [redis-cli, ping] }
            initialDelaySeconds: 3
            periodSeconds: 3
---
apiVersion: v1
kind: Service
metadata: { name: redis, namespace: $NAMESPACE }
spec: { selector: { app: redis }, ports: [{ name: redis, port: 6379, targetPort: redis }] }
---
apiVersion: v1
kind: Secret
metadata: { name: nodeaccess-runtime, namespace: $NAMESPACE }
type: Opaque
stringData:
  DATABASE_URL: $DATABASE_URL
  REDIS_URL: redis://redis:6379
  JWT_SECRET: nodeaccess-e2e-jwt-secret-with-more-than-32-characters
  PEM_ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
YAML
"$KUBECTL_BIN" apply -f "$runtime_dir/dependencies.yaml"
"$KUBECTL_BIN" -n "$NAMESPACE" wait --for=condition=available deployment/mysql deployment/redis --timeout=180s

"$KUBECTL_BIN" -n "$NAMESPACE" create configmap mock-ssh-files \
  --from-file=mock-ssh-server.cjs=tools/load-tests/scripts/mock-ssh-server.js \
  --from-file=mock-ssh-host-key=tools/load-tests/data/mock-ssh-host-key \
  --from-file=mock-ssh-host-key.pub=tools/load-tests/data/mock-ssh-host-key.pub
cat >"$runtime_dir/mock-ssh.yaml" <<YAML
apiVersion: apps/v1
kind: Deployment
metadata: { name: mock-ssh, namespace: $NAMESPACE }
spec:
  replicas: 1
  selector: { matchLabels: { app: mock-ssh } }
  template:
    metadata: { labels: { app: mock-ssh } }
    spec:
      securityContext: { runAsUser: 1000, runAsGroup: 1000 }
      containers:
        - name: mock-ssh
          image: $IMAGE
          imagePullPolicy: IfNotPresent
          command: [node, /app/mock/mock-ssh-server.cjs, --host, 0.0.0.0, --port, "2222", --key, /app/mock/mock-ssh-host-key]
          ports: [{ name: ssh, containerPort: 2222 }]
          readinessProbe: { tcpSocket: { port: ssh }, periodSeconds: 2 }
          volumeMounts: [{ name: mock-files, mountPath: /app/mock, readOnly: true }]
      volumes:
        - name: mock-files
          configMap: { name: mock-ssh-files, defaultMode: 0444 }
---
apiVersion: v1
kind: Service
metadata: { name: mock-ssh, namespace: $NAMESPACE }
spec: { selector: { app: mock-ssh }, ports: [{ name: ssh, port: 2222, targetPort: ssh }] }
YAML
"$KUBECTL_BIN" apply -f "$runtime_dir/mock-ssh.yaml"
"$KUBECTL_BIN" -n "$NAMESPACE" rollout status deployment/mock-ssh --timeout=120s

"$HELM_BIN" upgrade --install "$RELEASE" charts/nodeaccess -n "$NAMESPACE" \
  --set existingSecret=nodeaccess-runtime --set "image.repository=$IMAGE_REPOSITORY" \
  --set "image.tag=$IMAGE_TAG" --set image.pullPolicy=IfNotPresent \
  --set api.replicas=1 --set gateway.replicas=1 \
  --set gateway.drainTimeoutSeconds=40 --set gateway.terminationGracePeriodSeconds=60 \
  --wait --timeout 5m
"$HELM_BIN" test "$RELEASE" -n "$NAMESPACE" --timeout 2m

mysql_pf="$(start_port_forward "$NAMESPACE" service/mysql 13306:3306 "$runtime_dir/mysql-pf.log")"
pids+=("$mysql_pf")
env LOADTEST_USER_COUNT=1 LOADTEST_HOST_COUNT=1 LOADTEST_SSH_HOST=mock-ssh LOADTEST_SSH_PORT=2222 \
  LOADTEST_PROFILE="$PROFILE_FILE" DATABASE_URL='mysql://nodeaccess:nodeaccess-e2e-password@127.0.0.1:13306/nodeaccess' \
  JWT_SECRET='nodeaccess-e2e-jwt-secret-with-more-than-32-characters' \
  PEM_ENCRYPTION_KEY='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
  node tools/load-tests/scripts/seed-local-loadtest.js
stop_port_forward "$mysql_pf"

KUBECTL_BIN="$KUBECTL_BIN" HELM_BIN="$HELM_BIN" NODEACCESS_E2E_NAMESPACE="$NAMESPACE" \
  NODEACCESS_E2E_RELEASE="$RELEASE" NODEACCESS_E2E_IMAGE_TAG="$IMAGE_TAG" \
  VALID_DATABASE_URL="$DATABASE_URL" bash tools/deploy/helm-migration-recovery-harness.sh
PROFILE_FILE="$PROFILE_FILE" KUBECTL_BIN="$KUBECTL_BIN" NODEACCESS_E2E_NAMESPACE="$NAMESPACE" \
  NODEACCESS_E2E_RELEASE="$RELEASE" bash tools/deploy/helm-gateway-drain-harness.sh

openssl req -x509 -nodes -newkey rsa:2048 -keyout "$TLS_KEY" -out "$TLS_CERT" -days 1 \
  -subj '/CN=nodeaccess.test' -addext 'subjectAltName=DNS:nodeaccess.test'
"$KUBECTL_BIN" -n "$NAMESPACE" create secret tls nodeaccess-tls --cert="$TLS_CERT" --key="$TLS_KEY"

retry_external "$HELM_BIN" upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx --namespace ingress-nginx --create-namespace \
  --set controller.service.type=ClusterIP --wait --timeout 5m
"$HELM_BIN" upgrade "$RELEASE" charts/nodeaccess -n "$NAMESPACE" \
  --set existingSecret=nodeaccess-runtime --set "image.repository=$IMAGE_REPOSITORY" --set "image.tag=$IMAGE_TAG" \
  --set image.pullPolicy=IfNotPresent --set ingress.enabled=true --set ingress.className=nginx \
  --set ingress.host=nodeaccess.test --set ingress.tlsSecretName=nodeaccess-tls --wait --timeout 5m
nginx_pf="$(start_port_forward ingress-nginx service/ingress-nginx-controller 18443:443 "$runtime_dir/nginx-pf.log")"
pids+=("$nginx_pf")
curl --cacert "$TLS_CERT" --resolve nodeaccess.test:18443:127.0.0.1 --fail --silent https://nodeaccess.test:18443/health/ready >/dev/null
PROFILE_FILE="$PROFILE_FILE" INGRESS_PORT=18443 INGRESS_HOST=nodeaccess.test INGRESS_CA_FILE="$TLS_CERT" \
  node tools/deploy/helm-ingress-wss-client.cjs
stop_port_forward "$nginx_pf"

retry_external "$HELM_BIN" upgrade --install traefik traefik --repo https://traefik.github.io/charts \
  --namespace traefik --create-namespace --set service.type=ClusterIP --timeout 5m
"$KUBECTL_BIN" -n traefik rollout status deployment/traefik --timeout=180s
"$HELM_BIN" upgrade "$RELEASE" charts/nodeaccess -n "$NAMESPACE" \
  --set existingSecret=nodeaccess-runtime --set "image.repository=$IMAGE_REPOSITORY" --set "image.tag=$IMAGE_TAG" \
  --set image.pullPolicy=IfNotPresent --set ingress.enabled=true --set ingress.className=traefik \
  --set ingress.host=nodeaccess.test --set ingress.tlsSecretName=nodeaccess-tls --wait --timeout 5m
traefik_pf="$(start_port_forward traefik service/traefik 19443:443 "$runtime_dir/traefik-pf.log")"
pids+=("$traefik_pf")
curl --cacert "$TLS_CERT" --resolve nodeaccess.test:19443:127.0.0.1 --fail --silent https://nodeaccess.test:19443/health/ready >/dev/null
PROFILE_FILE="$PROFILE_FILE" INGRESS_PORT=19443 INGRESS_HOST=nodeaccess.test INGRESS_CA_FILE="$TLS_CERT" \
  node tools/deploy/helm-ingress-wss-client.cjs
stop_port_forward "$traefik_pf"

printf '{"install":true,"helmTest":true,"migrationRecovery":true,"gatewayDrain":true,"nginxTlsWss":true,"traefikTlsWss":true}\n'
