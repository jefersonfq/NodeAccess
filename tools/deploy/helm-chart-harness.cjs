#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const chart = path.join(root, 'charts/nodeaccess')
const helmImage = process.env.HELM_IMAGE || 'alpine/helm:3.17.3'

function helm(args, expectedStatus = 0) {
  const result = spawnSync('docker', [
    'run', '--rm', '-v', `${root}:/workspace`, '-w', '/workspace', helmImage, ...args,
  ], { encoding: 'utf8' })
  if (result.status !== expectedStatus) {
    throw new Error(`helm ${args.join(' ')} retornou ${result.status}\n${result.stdout}\n${result.stderr}`)
  }
  return `${result.stdout}${result.stderr}`
}

function requireMatch(content, expression, description) {
  if (!expression.test(content)) throw new Error(`Render inválido: ${description}`)
}

function requireAbsent(content, expression, description) {
  if (expression.test(content)) throw new Error(`Render inválido: ${description}`)
}

helm(['lint', 'charts/nodeaccess', '--set', 'existingSecret=nodeaccess-runtime'])

const minimal = helm([
  'template', 'nodeaccess', 'charts/nodeaccess', '--set', 'existingSecret=nodeaccess-runtime',
])
requireMatch(minimal, /kind: Deployment[\s\S]*app\.kubernetes\.io\/component: api/, 'deployment da API ausente')
requireMatch(minimal, /kind: Deployment[\s\S]*app\.kubernetes\.io\/component: gateway/, 'deployment do gateway ausente')
requireMatch(minimal, /helm\.sh\/hook: pre-install,pre-upgrade/, 'migration hook ausente')
requireMatch(minimal, /helm\.sh\/hook: test/, 'helm test de conectividade ausente')
requireMatch(minimal, /automountServiceAccountToken: false/, 'token do service account montado desnecessariamente')
requireMatch(minimal, /runAsNonRoot: true[\s\S]*runAsUser: 1000/, 'UID não-root explícito ausente')
requireMatch(minimal, /name: GATEWAY_DRAIN_TIMEOUT_SECONDS[\s\S]*value: "110"/, 'timeout de drenagem do gateway ausente')
requireAbsent(minimal, /app\.kubernetes\.io\/component: frontend/, 'frontend deve permanecer opt-in')
requireAbsent(minimal, /kind: (StatefulSet|PersistentVolumeClaim)/, 'chart não deve instalar bancos acoplados')
requireAbsent(minimal, /APP_FRONTEND_URL:\s*["']{2}/, 'variável URL vazia não deve ser injetada')

const production = helm([
  'template', 'nodeaccess', 'charts/nodeaccess', '-f', 'charts/nodeaccess/values-production.example.yaml',
])
requireMatch(production, /app\.kubernetes\.io\/component: frontend/, 'frontend de produção ausente')
requireMatch(production, /containerPort: 8080/, 'porta unprivileged do frontend incorreta')
requireMatch(production, /name: API_UPSTREAM[\s\S]*nodeaccess-api:3000/, 'upstream da API ausente')
requireMatch(production, /name: GATEWAY_UPSTREAM[\s\S]*nodeaccess-gateway:3001/, 'upstream do gateway ausente')
requireMatch(production, /path: \/[\s\S]*nodeaccess-frontend/, 'rota raiz do frontend ausente')
requireMatch(production, /kind: NetworkPolicy/, 'NetworkPolicy de produção ausente')
requireMatch(production, /alert: NodeAccessRedisUnavailable[\s\S]*nodeaccess_dependency_up\{dependency="redis"\}/, 'alerta explícito de Redis ausente')

const traefik = helm([
  'template', 'nodeaccess', 'charts/nodeaccess', '--set', 'existingSecret=nodeaccess-runtime',
  '--set', 'ingress.enabled=true', '--set', 'ingress.className=traefik',
  '--set', 'ingress.host=nodeaccess.test', '--set', 'ingress.tlsSecretName=nodeaccess-tls',
  '--set-json', 'ingress.annotations={}',
])
requireMatch(traefik, /ingressClassName: traefik/, 'IngressClass Traefik ausente')
requireMatch(traefik, /secretName: nodeaccess-tls/, 'secret TLS do Ingress ausente')
requireMatch(traefik, /path: "?\/ws"?[\s\S]*nodeaccess-gateway/, 'rota WebSocket do Traefik ausente')

const missingSecret = helm(['template', 'nodeaccess', 'charts/nodeaccess'], 1)
requireMatch(missingSecret, /existingSecret is required when migrations are enabled/, 'secret obrigatório não foi validado')

const invalidDrain = helm([
  'template', 'nodeaccess', 'charts/nodeaccess', '--set', 'existingSecret=nodeaccess-runtime',
  '--set', 'gateway.drainTimeoutSeconds=120', '--set', 'gateway.terminationGracePeriodSeconds=120',
], 1)
requireMatch(invalidDrain, /drainTimeoutSeconds must be lower/, 'relação entre drain timeout e grace period não foi validada')

const report = {
  changeId: 'NA-0015', result: 'passed', helmImage,
  lint: true, minimalRender: true, productionRender: true, traefikRender: true,
  migrationGuard: true, externalDatastores: true, connectivityHooks: true,
}
console.log(JSON.stringify(report, null, 2))
