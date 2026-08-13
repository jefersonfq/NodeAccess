#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || null
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-session-playback-playwright.json'
const ARTIFACTS_DIR = process.env.PLAYBACK_ARTIFACTS_DIR || '/tmp/nodeaccess-session-playback-artifacts'
const VISUAL_ARTIFACTS = process.env.PLAYBACK_VISUAL_ARTIFACTS === '1'
const SESSION_ID = 4177

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', userId: 1, tenantId: 1, role: 'admin', isPlatformAdmin: true, email: 'admin@example.test', stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const startedAt = '2026-08-13T12:00:00.000Z'
const detail = {
  sessionId: SESSION_ID, userId: 1, userNameSnapshot: 'Audit Admin', userEmailSnapshot: 'admin@example.test',
  hostId: 9, hostNameSnapshot: 'server-prod-01', hostIpSnapshot: '10.0.0.9', hostDeleted: false,
  status: 'COMPLETED', startedAt, endedAt: '2026-08-13T12:00:08.000Z', chunkCount: 1,
  bytesIn: 24, bytesOut: 180, connectionMethod: 'direct', clientIp: '127.0.0.1', agentRemoteIp: null,
  userAgent: 'playwright', aiSummaryStatus: 'NOT_REQUESTED', aiRiskLevel: null, criticalEvents: [],
  sharedSessionContext: null, routeSnapshot: null, ticketKey: null, ticketProvider: null, ticketUrl: null,
}
const events = [
  { seq: 1, type: 'session_started', timestamp: startedAt, bytes: null, text: '' },
  { seq: 2, type: 'stdout', timestamp: '2026-08-13T12:00:00.100Z', bytes: 18, text: '[admin@host ~]$ ' },
  { seq: 3, type: 'stdin', timestamp: '2026-08-13T12:00:01.000Z', bytes: 7, text: 'whoami\r' },
  { seq: 4, type: 'stdout', timestamp: '2026-08-13T12:00:01.100Z', bytes: 20, text: 'whoami\r\nadmin\r\n' },
  { seq: 5, type: 'stdin', timestamp: '2026-08-13T12:00:03.000Z', bytes: 12, text: 'systemctl status sshd\r' },
  { seq: 6, type: 'stdout', timestamp: '2026-08-13T12:00:03.300Z', bytes: 32, text: 'sshd.service - OpenSSH server\r\nActive: active\r\n' },
  { seq: 7, type: 'session_ended', timestamp: '2026-08-13T12:00:08.000Z', bytes: null, text: '' },
]
const commands = [
  { index: 1, command: 'whoami', output: 'admin', submittedAt: '2026-08-13T12:00:01.000Z', outputEndedAt: '2026-08-13T12:00:01.100Z', confidence: 'high', actorUserId: 1 },
  { index: 2, command: 'systemctl status sshd', output: 'sshd.service - OpenSSH server\nActive: active', submittedAt: '2026-08-13T12:00:03.000Z', outputEndedAt: '2026-08-13T12:00:03.300Z', confidence: 'high', actorUserId: 1 },
  { index: 3, command: 'vim notes.txt', output: '[interactive terminal output]', submittedAt: '2026-08-13T12:00:05.000Z', outputEndedAt: '2026-08-13T12:00:06.000Z', confidence: 'low', actorUserId: 1 },
]

function buildLongSessionFixture() {
  const specifications = [
    ['pwd', '/srv/nodeaccess', 'high'], ['whoami', 'audit-admin', 'high'], ['ls -la /var/log', 'total 48\ndrwxr-xr-x 8 root adm 4096', 'high'],
    ['df -h', 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 80G 31G 45G 41% /', 'high'], ['free -m', 'Mem: 15942 6231 4190 220 5520 8991', 'high'],
    ['ps aux | grep sshd', 'root 814 0.0 sshd: /usr/sbin/sshd -D', 'medium'], ['systemctl status sshd', 'sshd.service - OpenSSH server\nActive: active (running)', 'high'],
    ['journalctl -u sshd -n 20', 'Accepted publickey for audit-admin\nConnection closed normally', 'high'], ['docker logs --tail 20 gateway', 'gateway ready\nwebsocket connected', 'medium'],
    ['kubectl describe pod gateway-0', 'Status: Running\nReady: True', 'medium'], ['ip addr show eth0', 'inet 10.20.30.40/24 scope global eth0', 'high'],
    ['ss -ltnp', 'LISTEN 0 511 0.0.0.0:22 users:(("sshd",pid=814))', 'high'], ['ping -c 2 10.20.30.1', '2 packets transmitted, 2 received, 0% packet loss', 'high'],
    ['curl -fsS https://health.example.test', '{"status":"ok","latencyMs":18}', 'high'], ['find /etc -maxdepth 1 -name "ssh*"', '/etc/ssh', 'high'],
    ['grep -n "PermitRootLogin" /etc/ssh/sshd_config', '34:PermitRootLogin no', 'high'], ['tail -n 5 /var/log/auth.log', 'Aug 13 12:03:22 sshd[814]: session opened', 'high'],
    ['cat /tmp/utf8.txt', 'Operação concluída ✓ — São Paulo', 'high'], ['printf "line-1\\nline-2\\n"', 'line-1\nline-2', 'high'],
    ['sh -c "echo warning >&2; exit 2"', 'warning\ncommand exited with status 2', 'medium'], ['sleep 30 && echo resumed', 'resumed after long pause', 'high'],
    ['top -b -n 1', '\u001b[2J\u001b[Htop - 12:04:01 up 8 days\n%Cpu(s): 4.2 us, 1.0 sy', 'low'], ['vim /tmp/notes.txt', '\u001b[?1049hinteractive redraw frame\u001b[?1049l', 'low'],
    ['sudo systemctl reload sshd', '[sudo] password for audit-admin:\nReloaded sshd.service', 'medium'], ['chmod 640 /tmp/audit.log', '', 'high'],
    ['tar -czf /tmp/logs.tgz /var/log/nodeaccess', 'tar: Removing leading `/` from member names', 'high'], ['nc -vz 10.20.30.50 3306', 'Connection to 10.20.30.50 3306 port [tcp/mysql] succeeded!', 'high'],
    ['false', '', 'medium'], ['echo final-check', 'final-check', 'high'],
  ]
  const base = Date.parse('2026-08-13T12:00:00.000Z')
  const longEvents = [{ seq: 1, type: 'session_started', timestamp: new Date(base).toISOString(), bytes: null, text: '' }]
  const longCommands = []
  let seq = 2
  specifications.forEach(([command, output, confidence], index) => {
    const submittedMs = base + 3000 + index * 9800
    const outputMs = submittedMs + (command.startsWith('sleep ') ? 30000 : 900 + (index % 4) * 250)
    const submittedAt = new Date(submittedMs).toISOString()
    const outputEndedAt = new Date(outputMs).toISOString()
    longCommands.push({ index: index + 1, command, output, submittedAt, outputEndedAt, confidence, actorUserId: 1 })
    const split = Math.max(1, Math.floor(command.length / 2))
    longEvents.push({ seq: seq++, type: 'stdin', timestamp: submittedAt, bytes: split, text: command.slice(0, split) })
    longEvents.push({ seq: seq++, type: 'stdin', timestamp: new Date(submittedMs + 30).toISOString(), bytes: command.length - split + 1, text: `${command.slice(split)}\r` })
    if (index % 7 === 0) longEvents.push({ seq: seq++, type: 'resize', timestamp: new Date(submittedMs + 80).toISOString(), bytes: null, text: '', cols: 100 + index, rows: 30 })
    const chunks = output ? output.match(/[\s\S]{1,36}/g) || [] : []
    chunks.forEach((text, chunkIndex) => longEvents.push({ seq: seq++, type: 'stdout', timestamp: new Date(outputMs - Math.max(0, chunks.length - chunkIndex - 1) * 80).toISOString(), bytes: text.length, text }))
  })
  longEvents.push({ seq: seq++, type: 'session_error', timestamp: new Date(base + 292000).toISOString(), bytes: null, text: 'remote channel closed after command completion' })
  longEvents.push({ seq: seq++, type: 'session_ended', timestamp: new Date(base + 300000).toISOString(), bytes: null, text: '' })
  return { events: longEvents, commands: longCommands, logicalDurationMs: 300000 }
}

function buildScaleSessionFixture(commandCount = 600) {
  const templates = [
    (index) => [`pwd`, `/srv/workload/${index}`],
    (index) => [`ls -la /var/log/nodeaccess/${index}`, `total 24\n-rw-r----- 1 nodeaccess adm ${1024 + index} audit.log`],
    (index) => [`systemctl status worker-${index % 12}`, `worker-${index % 12}.service\nActive: active (running)`],
    (index) => [`journalctl -u worker-${index % 12} -n 5`, `worker=${index % 12} request completed latency=${12 + index % 80}ms`],
    (index) => [`ss -ltnp | grep :${3000 + index % 30}`, `LISTEN 0 511 0.0.0.0:${3000 + index % 30}`],
    (index) => [`curl -fsS https://service-${index % 20}.example.test/health`, `{"status":"ok","instance":${index}}`],
    (index) => [`grep -n "request-${index}" /var/log/app.log`, `${index}:request-${index} completed`],
    (index) => [`find /tmp/batch-${index % 25} -maxdepth 1 -type f`, `/tmp/batch-${index % 25}/result-${index}.json`],
    (index) => [`docker logs --tail 10 gateway-${index % 8}`, `gateway=${index % 8}\nconnection accepted\nrequest=${index}`],
    (index) => [`kubectl describe pod api-${index % 15}`, `Name: api-${index % 15}\nStatus: Running\nRestart Count: ${index % 3}`],
    (index) => [`chmod 640 /tmp/audit-${index}.log`, ''],
    (index) => [`cat /tmp/utf8-${index}.txt`, `Execução ${index} concluída ✓`],
  ]
  const base = Date.parse('2026-08-13T13:00:00.000Z')
  const scaleEvents = [{ seq: 1, type: 'session_started', timestamp: new Date(base).toISOString(), bytes: null, text: '' }]
  const scaleCommands = []
  const failures = { connectionDrops: 0, timeouts: 0, permissionDenied: 0, stderr: 0 }
  let seq = 2
  for (let index = 1; index <= commandCount; index += 1) {
    let [command, output] = templates[(index - 1) % templates.length](index)
    let confidence = index % 19 === 0 ? 'low' : index % 7 === 0 ? 'medium' : 'high'
    let eventType = 'stdout'
    if (index % 97 === 0) {
      output = 'client_loop: send disconnect: Broken pipe\nconnection re-established after 3 attempts'
      confidence = 'low'
      failures.connectionDrops += 1
    } else if (index % 53 === 0) {
      output = `command timed out after 30s (exit 124): ${command}`
      confidence = 'medium'
      failures.timeouts += 1
    } else if (index % 41 === 0) {
      output = `permission denied while executing: ${command}`
      confidence = 'medium'
      failures.permissionDenied += 1
    } else if (index % 37 === 0) {
      output = `stderr: transient warning for batch ${index}\noperation continued`
      eventType = 'session_error'
      confidence = 'medium'
      failures.stderr += 1
    }
    const submittedMs = base + index * 500
    const outputMs = submittedMs + 220
    const submittedAt = new Date(submittedMs).toISOString()
    const outputEndedAt = new Date(outputMs).toISOString()
    scaleCommands.push({ index, command, output, submittedAt, outputEndedAt, confidence, actorUserId: 1 })
    const splitAt = Math.max(1, Math.floor(command.length * 0.55))
    scaleEvents.push({ seq: seq++, type: 'stdin', timestamp: submittedAt, bytes: splitAt, text: command.slice(0, splitAt) })
    scaleEvents.push({ seq: seq++, type: 'stdin', timestamp: new Date(submittedMs + 15).toISOString(), bytes: command.length - splitAt + 1, text: `${command.slice(splitAt)}\r` })
    if (index % 50 === 0) scaleEvents.push({ seq: seq++, type: 'resize', timestamp: new Date(submittedMs + 30).toISOString(), bytes: null, text: '', cols: index % 100 === 0 ? 160 : 100, rows: index % 100 === 0 ? 48 : 30 })
    const chunks = output ? output.match(/[\s\S]{1,64}/g) || [] : []
    chunks.forEach((text, chunkIndex) => scaleEvents.push({ seq: seq++, type: eventType, timestamp: new Date(outputMs + chunkIndex * 10).toISOString(), bytes: text.length, text }))
  }
  scaleEvents.push({ seq: seq++, type: 'session_ended', timestamp: new Date(base + commandCount * 500 + 500).toISOString(), bytes: null, text: '' })
  return { events: scaleEvents, commands: scaleCommands, logicalDurationMs: commandCount * 500, failures }
}

async function installRoutes(context, options = {}) {
  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    if (options.detailFailure && pathname === `/api/v1/session-audit/${SESSION_ID}`) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"fixture failure"}' })
    }
    let body = []
    if (pathname === `/api/v1/session-audit/${SESSION_ID}`) body = detail
    else if (pathname.endsWith('/preview')) body = options.events ?? events
    else if (pathname.endsWith('/commands')) body = options.commands ?? commands
    else if (pathname.endsWith('/command-stats')) body = { total: (options.commands ?? commands).length, participants: [] }
    else if (pathname === '/api/v1/settings') body = { license: { sessionAuditAiEnabled: false } }
    else if (pathname === '/api/v1/integrations/jira') body = { enabled: false, hasApiToken: false, healthStatus: 'unknown' }
    else if (pathname === '/api/v1/features') body = {}
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function authenticate(page) {
  await page.addInitScript((token) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'playwright-placeholder')
  }, fakeJwt())
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({ viewport })
  await installRoutes(context)
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await authenticate(page)
  console.log(`[playback] opening ${viewport.width}x${viewport.height}`)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('session-playback-panel')
  await panel.waitFor()
  console.log(`[playback] panel ready ${viewport.width}x${viewport.height}`)
  const terminal = page.locator('[data-playback-terminal="true"]')
  if (await terminal.getAttribute('data-playback-mode') !== 'clean') throw new Error('Playback did not start in clean mode')
  const timelineMarkers = page.locator('[data-playback-marker]')
  if (await timelineMarkers.count() < commands.length + 1) throw new Error('Playback timeline is missing audit markers')
  await timelineMarkers.nth(1).click()
  if (Number(await terminal.getAttribute('data-playback-cursor-index')) < 1) throw new Error('Timeline marker did not move playback cursor')
  await page.getByRole('checkbox', { name: /Mostrar horarios|Show timestamps/ }).click()
  await page.locator('[data-playback-action="load-end"]').click()
  if (!/#\d+\]/.test(await terminal.textContent())) throw new Error('Timestamp mode did not expose event correlation')
  await page.getByRole('checkbox', { name: /Mostrar bruto|Show raw/ }).click()
  if (await terminal.getAttribute('data-playback-mode') !== 'raw') throw new Error('Raw stream mode did not activate')
  await page.getByRole('checkbox', { name: /Mostrar bruto|Show raw/ }).click()
  if (await terminal.getAttribute('data-playback-mode') !== 'clean') throw new Error('Clean stream mode did not restore')
  await page.getByTestId('playback-speed').click()
  await page.getByText('4x', { exact: true }).last().click()
  if (!(await page.getByTestId('playback-speed').textContent()).includes('4x')) throw new Error('Playback speed did not change to 4x')
  if (await terminal.getAttribute('contenteditable')) throw new Error('Playback terminal became editable')
  await terminal.focus()
  await page.keyboard.type('must-not-enter')
  if ((await terminal.textContent()).includes('must-not-enter')) throw new Error('Playback accepted keyboard input')

  await page.locator('[data-playback-action="play"]').click()
  await page.waitForFunction(() => Number(document.querySelector('[data-playback-terminal]')?.getAttribute('data-playback-cursor-index')) > 0)
  const playedCursor = Number(await terminal.getAttribute('data-playback-cursor-index'))
  await page.locator('[data-playback-action="play"]').click()
  const pausedCursor = Number(await terminal.getAttribute('data-playback-cursor-index'))
  await page.waitForTimeout(250)
  if (Number(await terminal.getAttribute('data-playback-cursor-index')) !== pausedCursor) throw new Error('Pause did not freeze cursor')

  await page.locator('[data-playback-action="load-end"]').click()
  if ((await page.getByTestId('playback-progress').textContent()).trim() !== '100%') throw new Error('Load end did not reach 100%')
  const finalText = await terminal.textContent()
  if (!finalText.includes('whoami') || !finalText.includes('Active: active')) throw new Error('Final playback is inconsistent with command fixture')
  await page.locator('[data-playback-action="restart"]').click()
  if ((await page.getByTestId('playback-progress').textContent()).trim() !== '0%') throw new Error('Restart did not return to 0%')

  await page.locator('.n-tabs-tab').filter({ hasText: /Comandos|Commands/ }).click()
  const rows = page.locator('[data-audit-command-row="true"]')
  if (await rows.count() !== commands.length) throw new Error('Command list row count mismatch')
  if (await page.locator('[data-audit-command-row="true"][data-command-confidence="low"]').count() !== 1) throw new Error('Low-confidence command metadata is missing')
  const confidenceFilter = page.getByTestId('command-confidence-filter')
  await confidenceFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').last().click()
  if (await rows.count() !== 1 || await rows.first().getAttribute('data-command-confidence') !== 'low') throw new Error('Confidence filter did not isolate low-confidence commands')
  await confidenceFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').first().click()
  const categoryFilter = page.getByTestId('command-category-filter')
  await categoryFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').filter({ hasText: /Serviço|service/i }).click({ force: true })
  if (await rows.count() !== 1 || !(await rows.first().textContent()).includes('systemctl status sshd')) throw new Error('Category filter did not isolate service commands')
  await categoryFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').filter({ hasText: /Todas categorias|All categories/i }).click({ force: true })
  const commandSearch = page.getByPlaceholder(/Filtrar por comando ou saída|Filter by command or output/)
  await commandSearch.fill('systemctl')
  if (await rows.count() !== 1) throw new Error('Command search did not narrow results')
  await page.evaluate(() => {
    window.__playbackExport = { blob: null, filename: null }
    const createObjectURL = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      window.__playbackExport.blob = blob
      return createObjectURL(blob)
    }
    document.addEventListener('click', (event) => {
      const anchor = event.target.closest?.('a[download]')
      if (anchor) window.__playbackExport.filename = anchor.download
    }, true)
  })
  await page.getByRole('button', { name: /Exportar CSV|Export CSV/ }).click()
  const exported = await page.evaluate(async () => ({
    filename: window.__playbackExport.filename,
    csv: await window.__playbackExport.blob?.text(),
  }))
  if (exported.filename !== `session-audit-${SESSION_ID}-commands.csv`) throw new Error('CSV export filename is inconsistent')
  const csv = exported.csv || ''
  if (!csv.includes('systemctl status sshd') || csv.includes('vim notes.txt')) throw new Error('Filtered CSV export does not match visible commands')
  await commandSearch.fill('')
  if (await rows.count() !== commands.length) throw new Error('Clearing command search did not restore results')
  await rows.nth(1).getByRole('button', { name: /Ver no playback|View in playback/ }).click()
  await panel.waitFor()
  if (!(await terminal.textContent()).includes('systemctl status sshd')) throw new Error('Command jump did not correlate playback')

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  if (dimensions.document > dimensions.viewport + 2) throw new Error(`Horizontal overflow: ${dimensions.document} > ${dimensions.viewport}`)
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
  const markerCount = await timelineMarkers.count()
  await context.close()
  return { name: `${viewport.width}x${viewport.height}`, playedCursor, commandRows: commands.length, timelineMarkers: markerCount, modes: ['clean', 'raw'], csvExport: true, horizontalOverflow: false }
}

async function runErrorState(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await installRoutes(context, { detailFailure: true })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await authenticate(page)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('alert').waitFor()
  const exposed = (await page.locator('body').textContent()).includes('fixture failure')
  await context.close()
  if (exposed) throw new Error('Internal API detail leaked into public error state')
  return { publicError: true, internalDetailExposed: false }
}

async function runEmptyState(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await installRoutes(context, { events: [], commands: [] })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await authenticate(page)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('session-playback-panel').waitFor()
  for (const action of ['play', 'restart', 'load-end']) {
    if (!(await page.locator(`[data-playback-action="${action}"]`).isDisabled())) throw new Error(`Empty playback action remained enabled: ${action}`)
  }
  await page.locator('.n-tabs-tab').filter({ hasText: /Comandos|Commands/ }).click()
  if (await page.locator('[data-audit-command-row="true"]').count()) throw new Error('Empty command list rendered rows')
  await context.close()
  return { playbackActionsDisabled: true, commandRows: 0 }
}

async function runTruncatedState(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const truncatedEvents = Array.from({ length: 5000 }, (_, index) => ({
    seq: index + 1,
    type: index === 0 ? 'session_started' : 'stdout',
    timestamp: new Date(Date.parse(startedAt) + index).toISOString(),
    bytes: 0,
    text: '',
  }))
  await installRoutes(context, { events: truncatedEvents, commands: [] })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await authenticate(page)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('playback-truncated-warning').waitFor()
  const warning = (await page.getByTestId('playback-truncated-warning').textContent()).trim()
  if (!warning.includes('5000') && !warning.includes('5,000')) throw new Error('Truncation warning does not expose the event limit')
  await context.close()
  return { warningVisible: true, eventLimit: truncatedEvents.length }
}

async function runLongSession(browser) {
  const fixture = buildLongSessionFixture()
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...(VISUAL_ARTIFACTS ? { recordVideo: { dir: ARTIFACTS_DIR, size: { width: 1440, height: 1000 } } } : {}),
  })
  if (VISUAL_ARTIFACTS) await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await installRoutes(context, fixture)
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await authenticate(page)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  const terminal = page.locator('[data-playback-terminal="true"]')
  await terminal.waitFor()
  const timelineLength = Number(await terminal.getAttribute('data-playback-timeline-length'))
  const expectedTimelineLength = fixture.commands.length + fixture.commands.filter((command) => command.output.trim()).length
  if (timelineLength !== expectedTimelineLength) throw new Error(`Long session timeline mismatch: ${timelineLength} != ${expectedTimelineLength}`)
  const markers = page.locator('[data-playback-marker]')
  if (await markers.count() < fixture.commands.length + 1) throw new Error('Long session markers are incomplete')
  for (const markerIndex of [1, 7, 14, 21, fixture.commands.length]) {
    await markers.nth(markerIndex).click()
    if (Number(await terminal.getAttribute('data-playback-cursor-index')) <= 0) throw new Error(`Long session marker ${markerIndex} did not seek`)
  }
  await page.getByTestId('playback-speed').click()
  await page.getByText('4x', { exact: true }).last().click()
  await page.locator('[data-playback-action="restart"]').click()
  await page.locator('[data-playback-action="play"]').click()
  await page.waitForFunction(() => Number(document.querySelector('[data-playback-terminal]')?.getAttribute('data-playback-cursor-index')) >= 8)
  await page.locator('[data-playback-action="play"]').click()
  await page.locator('[data-playback-action="load-end"]').click()
  const finalText = await terminal.textContent()
  for (const sample of ['audit-admin', 'Active: active', '0% packet loss', 'Operação concluída', 'final-check']) {
    if (!finalText.includes(sample)) throw new Error(`Long session output missing: ${sample}`)
  }
  if ((await page.getByTestId('playback-progress').textContent()).trim() !== '100%') throw new Error('Long session did not reach 100%')
  await page.locator('.n-tabs-tab').filter({ hasText: /Comandos|Commands/ }).click()
  if (await page.locator('[data-audit-command-row="true"]').count() !== fixture.commands.length) throw new Error('Long session command list is incomplete')
  const metrics = await cdp.send('Performance.getMetrics')
  const selectedMetrics = Object.fromEntries(metrics.metrics.filter((metric) => ['JSHeapUsedSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration'].includes(metric.name)).map((metric) => [metric.name, Math.round(metric.value * 1000) / 1000]))
  await page.waitForTimeout(800)
  const commandsScreenshot = path.join(ARTIFACTS_DIR, 'long-session-commands.png')
  await page.screenshot({ path: commandsScreenshot, fullPage: false })
  await page.locator('.n-tabs-tab').filter({ hasText: /Playback/ }).click()
  await page.waitForTimeout(800)
  const playbackScreenshot = path.join(ARTIFACTS_DIR, 'long-session-playback.png')
  await page.screenshot({ path: playbackScreenshot, fullPage: false })
  const recordedVideo = VISUAL_ARTIFACTS ? page.video() : null
  const markerCount = await markers.count()
  if (browserErrors.length) throw new Error(`Long session browser errors: ${browserErrors.join(' | ')}`)
  if (VISUAL_ARTIFACTS) await context.tracing.stop({ path: path.join(ARTIFACTS_DIR, 'long-session-trace.zip') })
  await context.close()
  const video = recordedVideo ? await recordedVideo.path() : null
  return { logicalDurationMs: fixture.logicalDurationMs, events: fixture.events.length, commands: fixture.commands.length, timelineLength, markerCount, selectedMetrics, artifacts: { playbackScreenshot, commandsScreenshot, video, trace: VISUAL_ARTIFACTS ? path.join(ARTIFACTS_DIR, 'long-session-trace.zip') : null } }
}

async function runScaleSession(browser) {
  const fixture = buildScaleSessionFixture(600)
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await installRoutes(context, fixture)
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  await page.addInitScript(() => {
    window.__playbackLongTasks = []
    new PerformanceObserver((list) => window.__playbackLongTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true })
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await authenticate(page)
  const openedAt = Date.now()
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  const terminal = page.locator('[data-playback-terminal="true"]')
  await terminal.waitFor()
  const openMs = Date.now() - openedAt
  const expectedTimelineLength = fixture.commands.length + fixture.commands.filter((command) => command.output.trim()).length
  if (Number(await terminal.getAttribute('data-playback-timeline-length')) !== expectedTimelineLength) throw new Error('Scale timeline lost steps')
  const displayedMarkers = await page.locator('[data-playback-marker]').count()
  if (displayedMarkers > 200 || displayedMarkers < 100) throw new Error(`Scale marker sampling is outside budget: ${displayedMarkers}`)
  await page.getByTestId('playback-sampled-markers').waitFor()

  await page.getByTestId('playback-speed').click()
  await page.getByText('4x', { exact: true }).last().click()
  await page.locator('[data-playback-action="play"]').click()
  await page.waitForFunction(() => Number(document.querySelector('[data-playback-terminal]')?.getAttribute('data-playback-cursor-index')) >= 40)
  await page.locator('[data-playback-action="play"]').click()
  const slider = page.getByTestId('playback-seek-control').locator('.n-slider')
  const sliderBox = await slider.boundingBox()
  if (!sliderBox) throw new Error('Scale playback slider is not visible')
  await page.mouse.click(sliderBox.x + sliderBox.width * 0.5, sliderBox.y + sliderBox.height / 2)
  const middleCursor = Number(await terminal.getAttribute('data-playback-cursor-index'))
  if (middleCursor < expectedTimelineLength * 0.4 || middleCursor > expectedTimelineLength * 0.6) throw new Error('Scale seek did not reach timeline midpoint')
  const endStartedAt = Date.now()
  await page.locator('[data-playback-action="load-end"]').click()
  await page.getByTestId('playback-progress').filter({ hasText: '100%' }).waitFor()
  const renderEndMs = Date.now() - endStartedAt
  const finalText = await terminal.textContent()
  for (const sample of ['command timed out after 30s', 'Broken pipe', 'permission denied', 'Execução 600 concluída']) {
    if (!finalText.includes(sample)) throw new Error(`Scale playback missing failure/output sample: ${sample}`)
  }
  const commandTabStartedAt = Date.now()
  await page.locator('.n-tabs-tab').filter({ hasText: /Comandos|Commands/ }).click()
  const rows = page.locator('[data-audit-command-row="true"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-audit-command-row="true"]').length === 100)
  const commandListRenderMs = Date.now() - commandTabStartedAt
  if (await rows.count() !== 100) throw new Error('Scale command pagination did not cap the DOM at 100 commands')
  const pageTurnStartedAt = Date.now()
  for (let pageIndex = 1; pageIndex < 6; pageIndex += 1) await page.getByRole('button', { name: /Próxima|Next/ }).click()
  const pageTurnMs = Date.now() - pageTurnStartedAt
  if (await rows.count() !== 100 || await rows.last().getAttribute('data-command-index') !== '600') throw new Error('Scale pagination did not reach command 600')
  const commandSearch = page.getByPlaceholder(/Filtrar por comando ou saída|Filter by command or output/)
  await commandSearch.fill('timed out after 30s')
  if (await rows.count() !== fixture.failures.timeouts) throw new Error('Scale failure search did not find all timeouts')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  const metrics = await cdp.send('Performance.getMetrics')
  const selectedMetrics = Object.fromEntries(metrics.metrics.filter((metric) => ['JSHeapUsedSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration'].includes(metric.name)).map((metric) => [metric.name, Math.round(metric.value * 1000) / 1000]))
  const longTasks = await page.evaluate(() => window.__playbackLongTasks)
  const longTaskTotalMs = Math.round(longTasks.reduce((total, value) => total + value, 0))
  const longTaskMaxMs = Math.round(Math.max(0, ...longTasks))
  const liveDomNodes = await page.evaluate(() => document.querySelectorAll('*').length)
  const screenshot = path.join(ARTIFACTS_DIR, 'scale-600-commands.png')
  await page.waitForTimeout(500)
  await page.screenshot({ path: screenshot, fullPage: false })
  if (openMs > 10000 || renderEndMs > 3000 || commandListRenderMs > 4000 || pageTurnMs > 6000) throw new Error(`Scale performance budget exceeded: open=${openMs}, end=${renderEndMs}, commands=${commandListRenderMs}, pages=${pageTurnMs}`)
  if (longTaskMaxMs > 1500 || liveDomNodes > 15000) throw new Error(`Scale fluency budget exceeded: longestTask=${longTaskMaxMs}, liveNodes=${liveDomNodes}`)
  if (errors.length) throw new Error(`Scale browser errors: ${errors.join(' | ')}`)
  await context.close()
  return { logicalDurationMs: fixture.logicalDurationMs, events: fixture.events.length, commands: fixture.commands.length, timelineLength: expectedTimelineLength, displayedMarkers, renderedCommandRows: 100, failures: fixture.failures, openMs, renderEndMs, commandListRenderMs, pageTurnMs, longTasks: longTasks.length, longTaskTotalMs, longTaskMaxMs, liveDomNodes, selectedMetrics, screenshot }
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(EXECUTABLE_PATH ? { executablePath: EXECUTABLE_PATH } : {}) })
  const started = Date.now()
  try {
    const viewports = []
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) viewports.push(await runViewport(browser, viewport))
    const errorState = await runErrorState(browser)
    const emptyState = await runEmptyState(browser)
    const truncatedState = await runTruncatedState(browser)
    const longSession = await runLongSession(browser)
    const scaleSession = await runScaleSession(browser)
    const report = { ok: true, runner: 'playwright', durationMs: Date.now() - started, fixtures: { events: events.length, commands: commands.length }, viewports, errorState, emptyState, truncatedState, longSession, scaleSession }
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, durationMs: report.durationMs, viewports: report.viewports }))
  } finally { await browser.close() }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1 })
