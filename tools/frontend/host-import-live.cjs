// Opt-in: disposable records in the local development API; never opens SSH sessions.
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const base = process.env.IMPORT_TEST_API || 'http://127.0.0.1:3000/api/v1'
async function main() {
 if (process.env.RUN_HOST_IMPORT_LIVE !== 'true') throw Error('Set RUN_HOST_IMPORT_LIVE=true for disposable local API records')
 if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('This harness only targets a local development API')
 const secret = fs.readFileSync('apps/backend/.env', 'utf8').match(/^JWT_SECRET=(.+)$/m)[1].trim().replace(/^"|"$/g, '')
 const now = Math.floor(Date.now()/1000)
 const body = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@nodeaccess.local', name: 'Admin', stage: 'authenticated', iat: now, exp: now+3600 })).toString('base64url')
 const token = body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url')
 async function api(path, method='GET', data) {
  const response = await fetch(base+path, { method, headers: { Authorization: 'Bearer '+token, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) })
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? null : response.json()
 }
 const suffix = crypto.randomBytes(5).toString('hex'), prefix = 'qa-import-'+suffix
 let bastion, folder; const ownedIds = new Set(), importIds = []
 const report = { ok: false, prefix, scenarios: [], imports: [] }
 try {
  const root = (await api('/inventory')).find(node => node.type === 'ROOT' && node.parentId === null)
  assert.ok(root)
  folder = await api('/inventory/folders', 'POST', { parentId: root.id, name: prefix })
  bastion = await api('/bastions', 'POST', { name: prefix+'-jump', ip: '127.0.0.244', port: 22029, sshUser: prefix, authType: 'password', password: crypto.randomBytes(24).toString('hex') })
  const hosts = [
   { sourceId: 'direct', name: prefix+'-direct', ip: prefix+'-direct.invalid', port: 22, accessProtocol: 'ssh', sshUser: 'qa', authType: 'password', connectionMode: 'direct', folderPath: [], warnings: [] },
   { sourceId: 'jump', name: prefix+'-target', ip: prefix+'-target.invalid', port: 2222, accessProtocol: 'ssh', sshUser: 'qa', authType: 'password', connectionMode: 'direct', bastionId: bastion.id, folderPath: ['Targets'], warnings: [] },
  ]
  const draft = { source: 'csv', destinationId: folder.id, preserveHierarchy: true, duplicateStrategy: 'skip', hosts, aclMappings: [], sourceStats: { invalidConnections: 0, unsupportedProtocols: [], unmappedPermissions: 0 } }
  async function importBatch(payload) {
   const preview = await api('/host-imports/preview', 'POST', payload)
   const result = await api('/host-imports/commit', 'POST', { previewId: preview.previewId, confirm: true })
   result.rows.filter(row => row.status === 'created').forEach(row => ownedIds.add(row.hostId))
   if (result.importId) importIds.push(result.importId)
   report.imports.push({ preview: preview.summary, result })
   return result
  }
  const created = await importBatch(draft)
  assert.equal(created.status, 'committed'); assert.equal(created.createdHosts, 2)
  const direct = await api('/hosts/'+created.rows.find(row => row.sourceId === 'direct').hostId)
  const targetId = created.rows.find(row => row.sourceId === 'jump').hostId
  const target = await api('/hosts/'+targetId)
  assert.equal(direct.bastionId, null); assert.equal(target.bastionId, bastion.id)
  assert.equal(target.port, 2222); assert.equal(target.sshUser, 'qa'); assert.equal(target.name, hosts[1].name)
  assert.notEqual(target.inventoryParentId, folder.id)
  report.scenarios.push('created direct/bastion records and hierarchy match report')
  const skipped = await importBatch(draft)
  assert.equal(skipped.createdHosts, 0); assert.equal(skipped.rows.filter(row => row.status === 'skipped').length, 2)
  report.scenarios.push('duplicate skip does not create records')
  const changed = await importBatch({ ...draft, duplicateStrategy: 'update', hosts: [{ ...hosts[1], name: prefix+'-adjusted', bastionId: undefined, folderPath: [] }] })
  assert.equal(changed.rows[0].status, 'updated'); assert.equal(changed.rows[0].hostId, targetId)
  const updated = await api('/hosts/'+targetId)
  assert.equal(updated.bastionId, null); assert.equal(updated.name, prefix+'-adjusted'); assert.equal(updated.inventoryParentId, folder.id)
  report.scenarios.push('duplicate update removes bastion and adjusts name/folder in storage')
  const reverted = await api('/host-imports/'+changed.importId+'/revert', 'POST')
  assert.equal(reverted.status, 'reverted')
  const restored = await api('/hosts/'+targetId)
  assert.equal(restored.bastionId, bastion.id); assert.equal(restored.name, hosts[1].name)
  importIds.splice(importIds.indexOf(changed.importId), 1)
  report.scenarios.push('revert restores persisted bastion and metadata')
  report.ok = true
 } catch (error) { report.failure = error.message; throw error } finally {
  fs.writeFileSync('/tmp/nodeaccess-host-import-live.json', JSON.stringify(report, null, 2))
  // Only resources tracked from this uniquely named batch are touched.
  for (const id of importIds.reverse()) { try { await api('/host-imports/'+id+'/revert', 'POST') } catch (error) { report.cleanupError = error.message } }
  for (const id of ownedIds) {
   try { const host = await api('/hosts/'+id); if (host.name.startsWith(prefix)) await api('/hosts/'+id, 'DELETE') } catch (error) { if (!error.message.includes(': 404 ')) report.cleanupError = error.message }
  }
  if (bastion) await api('/bastions/'+bastion.id, 'DELETE')
  if (folder) {
   const nodes = await api('/inventory')
   const children = nodes.filter(node => node.type === 'FOLDER' && node.path.startsWith(`/${folder.id}/`) && node.id !== folder.id).sort((a,b) => b.depth-a.depth)
   for (const child of children) await api('/inventory/folders/'+child.id, 'DELETE')
   await api('/inventory/folders/'+folder.id, 'DELETE')
  }
  fs.writeFileSync('/tmp/nodeaccess-host-import-live.json', JSON.stringify(report, null, 2))
 }
 assert.ok(!report.cleanupError, report.cleanupError)
 console.log(JSON.stringify({ ok: report.ok, scenarios: report.scenarios, report: '/tmp/nodeaccess-host-import-live.json' }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
