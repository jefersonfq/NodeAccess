#!/usr/bin/env npx tsx
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { parseGuacamoleExport, parseGuacamoleJdbcExport, parseGuacamoleUserMapping } from '../../apps/frontend/src/services/guacamole-import.service'

const CONNECTION_COUNT = Number(process.env.GUACAMOLE_HARNESS_CONNECTIONS || 2_000)
const protocols = ['ssh', 'rdp', 'vnc', 'telnet'] as const
const fixtureUrl = (name: string) => new URL(`../../apps/frontend/src/services/__fixtures__/guacamole/${name}`, import.meta.url)

const connections = Array.from({ length: CONNECTION_COUNT }, (_, index) => {
  const protocol = protocols[index % protocols.length]
  return `<connection name="host-${index}">
    <protocol>${protocol}</protocol>
    <param name="hostname">host-${index}.example.test</param>
    <param name="username">operator-${index % 20}</param>
    <param name="password">must-never-leak-${index}</param>
  </connection>`
}).join('\n')

const shared = `<connection name="shared"><protocol>ssh</protocol><param name="hostname">shared.example.test</param></connection>`
const xml = `<user-mapping>
  <authorize username="alice">${connections}${shared}</authorize>
  <authorize username="bob">${shared}</authorize>
  <authorize username="unsupported"><connection name="k8s"><protocol>kubernetes</protocol><param name="hostname">cluster</param></connection></authorize>
</user-mapping>`

const startedAt = performance.now()
const result = parseGuacamoleUserMapping(xml)
const durationMs = performance.now() - startedAt
const serialized = JSON.stringify(result)

assert.equal(result.hosts.length, CONNECTION_COUNT + 1, 'all compatible unique connections must be preserved')
assert.equal(result.invalidConnections, 1, 'unsupported connections must be counted')
assert.deepEqual(result.unsupportedProtocols, ['kubernetes'])
assert(result.hosts.some(host => host.name === 'shared' && host.warnings.includes('duplicate-merged')))
assert(!serialized.includes('must-never-leak'), 'secrets must not survive parsing')
assert(durationMs < 5_000, `preview parsing took too long: ${durationMs.toFixed(1)}ms`)

const jdbcStartedAt = performance.now()
const jdbcResult = parseGuacamoleJdbcExport(JSON.stringify({
  connectionGroups: [
    { id: 1, parentId: null, name: 'Brasil', type: 'ORGANIZATIONAL' },
    { id: 2, parentId: 1, name: 'Produção', type: 'ORGANIZATIONAL' },
  ],
  connections: Array.from({ length: CONNECTION_COUNT }, (_, index) => ({
    id: index + 1,
    parentId: 2,
    name: `jdbc-host-${index}`,
    protocol: protocols[index % protocols.length],
  })),
  connectionParameters: Array.from({ length: CONNECTION_COUNT }, (_, index) => ({
    connectionId: index + 1,
    name: 'hostname',
    value: `jdbc-host-${index}.example.test`,
  })),
}))
const jdbcDurationMs = performance.now() - jdbcStartedAt
assert.equal(jdbcResult.hosts.length, CONNECTION_COUNT)
assert(jdbcResult.hosts.every(host => host.folderPath.join('/') === 'Brasil/Produção'))
assert(jdbcDurationMs < 5_000, `JDBC hierarchy parsing took too long: ${jdbcDurationMs.toFixed(1)}ms`)

const fixtureExpectations = [
  ['user-mapping-complete.xml', 4, 1],
  ['user-mapping-default.xml', 1, 0],
  ['jdbc-hierarchy-snake-case.json', 3, 0],
  ['jdbc-mixed-quality.json', 2, 2],
] as const
for (const [name, expectedHosts, expectedInvalid] of fixtureExpectations) {
  const fixtureResult = parseGuacamoleExport(readFileSync(fixtureUrl(name), 'utf8'))
  assert.equal(fixtureResult.hosts.length, expectedHosts, `${name}: imported host count`)
  assert.equal(fixtureResult.invalidConnections, expectedInvalid, `${name}: invalid connection count`)
}
for (const name of ['user-mapping-invalid.xml', 'jdbc-invalid.json']) {
  assert.throws(() => parseGuacamoleExport(readFileSync(fixtureUrl(name), 'utf8')), undefined, `${name} must be rejected`)
}

console.log(JSON.stringify({
  status: 'passed',
  inputConnections: CONNECTION_COUNT + 3,
  importedConnections: result.hosts.length,
  skippedConnections: result.invalidConnections,
  durationMs: Number(durationMs.toFixed(1)),
  jdbcHierarchyConnections: jdbcResult.hosts.length,
  jdbcDurationMs: Number(jdbcDurationMs.toFixed(1)),
  secretsRetained: false,
  versionedFixturesValidated: fixtureExpectations.length + 2,
}, null, 2))
