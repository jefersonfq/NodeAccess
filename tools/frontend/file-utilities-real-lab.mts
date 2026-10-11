/** Opt-in, isolated API/gateway fixture for real PTY certification. No database. */
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { writeFileSync } from 'node:fs'
import { SshSession } from '../../apps/backend/src/modules/ssh/ssh.session.js'
import { encrypt } from '../../apps/backend/src/shared/crypto.js'
if (process.env.RUN_FILE_UTILITIES_LAB !== 'true') throw new Error('Opt-in lab only')
const host = { id: 9401, tenantId: 1, name: 'utilities-disposable-pty', ip: '127.0.0.1', port: 22283, sshUser: 'sftptest', authType: 'password', accessProtocol: 'ssh', operatingSystem: 'linux', deviceProfile: 'linux', connectionMode: 'direct', scope: 'personal', groupId: null, folderId: null, inventoryNodeId: null, inventoryParentId: null, bastionId: null, pemKeyId: null, tags: [], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: false, admin: false }, createdAt: new Date().toISOString() }
const settings = { tenant: { id: 1, name: 'Disposable lab', slug: 'lab' }, license: { maxUsers: 1, maxHosts: 1, activeUsers: 1, registeredHosts: 1, hasKey: true, multiConnect: true, featureEntitlements: {}, integrationEntitlements: {} }, sessionLimits: { activeSessions: 0, maxPerUser: 3, maxPerTenant: 3 }, tenantSettings: { hostsDefaultView: 'list', manualEnabled: false }, passwordPolicy: { minLength: 12, description: 'lab' }, sharedSessions: { expiryMinutes: [5], maxExpiryMinutes: 5 }, jitAccess: { enabled: false }, sftpPolicy: {} }
const api = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost'); const path = url.pathname
  let data: unknown = {}
  if (path === '/api/v1/hosts/9401') data = host
  else if (path === '/api/v1/hosts') data = { data: [host], total: 1, page: 1, limit: 50 }
  else if (path === '/api/v1/hosts/by-ids') data = [host]
  else if (path === '/api/v1/hosts/sidebar-bootstrap') data = { summary: { all: 1, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
  else if (path === '/api/v1/settings') data = settings
  else if (path === '/api/v1/features') data = { multiConnect: true, agentsLicensed: false, terminalAutocompleteLicensed: false, terminalAiLicensed: false, integrationsLicensed: false, snippetsLicensed: false, secretsLicensed: false, feedbackLicensed: false, localAiLicensed: false, portForwardingLicensed: false, sharedSessions: { expiryMinutes: [5], maxExpiryMinutes: 5 } }
  else if (path === '/api/v1/sessions/access-map') data = { hosts: [], totals: {}, refreshAfterSeconds: 30 }
  else if (path === '/api/v1/users/me/preferences') data = null
  else if (/groups|inventory|snippets|tunnels|tags/.test(path)) data = []
  else if (path === '/api/v1/terminal-highlights/effective') data = { enabled: false, rules: [], templates: [], version: 'lab', limits: {} }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data))
})
const gateway = http.createServer()
const sockets = new WebSocketServer({ server: gateway })
let id = 10000
sockets.on('connection', async (ws, req) => {
  if (!req.url?.startsWith('/ws/ssh/')) { ws.on('message', () => {}); return }
  const url = new URL(req.url, 'http://localhost')
  const sessionId = ++id
  const session = new SshSession(ws, { host: '127.0.0.1', port: 22283, username: 'sftptest', authType: 'PASSWORD', passwordEncrypted: JSON.stringify(encrypt('disposable-sftp-review')) })
  ws.on('close', () => session.dispose())
  try {
    await session.connect(Number(url.searchParams.get('cols') ?? 80), Number(url.searchParams.get('rows') ?? 24))
    ws.send(JSON.stringify({ type: 'connected', sessionId, hostName: host.name, connectionMethod: 'direct' }))
    ws.on('message', (raw, binary) => {
      if (binary) { session.write(Buffer.from(raw as Buffer)); return }
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'resize') session.resize(msg.cols, msg.rows)
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
      } catch { /* invalid frame */ }
    })
  } catch { ws.close(1011) }
})
api.listen(3000, '127.0.0.1')
gateway.listen(3001, '127.0.0.1')
writeFileSync('/tmp/nodeaccess-utilities-lab.env', `JWT_SECRET=${process.env.JWT_SECRET}\n`)
console.log('Disposable lab API :3000 and SSH gateway :3001 ready; fixture auth, real SshSession/OpenSSH')
function stop() { for (const ws of sockets.clients) ws.close(); sockets.close(); gateway.close(); api.close() }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
