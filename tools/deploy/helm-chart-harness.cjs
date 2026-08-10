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
requireAbsent(minimal, /app\.kubernetes\.io\/component: frontend/, 'frontend deve permanecer opt-in')
requireAbsent(minimal, /kind: (StatefulSet|PersistentVolumeClaim)/, 'chart não deve instalar bancos acoplados')

const production = helm([
  'template', 'nodeaccess', 'charts/nodeaccess', '-f', 'charts/nodeaccess/values-production.example.yaml',
])
requireMatch(production, /app\.kubernetes\.io\/component: frontend/, 'frontend de produção ausente')
requireMatch(production, /containerPort: 8080/, 'porta unprivileged do frontend incorreta')
requireMatch(production, /name: API_UPSTREAM[\s\S]*nodeaccess-api:3000/, 'upstream da API ausente')
requireMatch(production, /name: GATEWAY_UPSTREAM[\s\S]*nodeaccess-gateway:3001/, 'upstream do gateway ausente')
requireMatch(production, /path: \/[\s\S]*nodeaccess-frontend/, 'rota raiz do frontend ausente')
requireMatch(production, /kind: NetworkPolicy/, 'NetworkPolicy de produção ausente')

const missingSecret = helm(['template', 'nodeaccess', 'charts/nodeaccess'], 1)
requireMatch(missingSecret, /existingSecret is required when migrations are enabled/, 'secret obrigatório não foi validado')

const report = {
  changeId: 'NA-0015', result: 'passed', helmImage,
  lint: true, minimalRender: true, productionRender: true,
  migrationGuard: true, externalDatastores: true, connectivityHooks: true,
}
console.log(JSON.stringify(report, null, 2))
