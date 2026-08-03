#!/usr/bin/env node
/*
 * Host presence/avatar UX harness via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9344 --user-data-dir=/tmp/nodeaccess-host-presence \
 *     --window-size=1440,1000 about:blank
 *
 *   FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9344 \
 *     node tools/frontend/host-presence-avatar-harness.cjs
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9344'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '1'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nodeaccess.local'
const TENANT_ID = Number(process.env.TENANT_ID || '1')
const HOST_ID = process.env.HOST_ID ? Number(process.env.HOST_ID) : 9301
const DISPLAY_MODE = process.env.DISPLAY_MODE === 'cards' ? 'cards' : 'list'
const REPORT_PATH = process.env.REPORT_PATH || ''

function readJwtSecret() {
  const envPath = process.env.BACKEND_ENV_PATH || path.join(REPO_ROOT, 'apps/backend/.env')
  const envFile = fs.readFileSync(envPath, 'utf8')
  const match = envFile.match(/^JWT_SECRET=(.+)$/m)
  if (!match) throw new Error(`JWT_SECRET not found in ${envPath}`)
  return match[1].trim().replace(/^"|"$/g, '')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function signJwt(payload, secret, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify({ iat: now, exp: now + ttlSeconds, ...payload }))
  const data = `${header}.${body}`
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timeout } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(timeout)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
        return
      }
      if (msg.method) this.events.push({ at: Date.now(), ...msg })
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15000)
      this.pending.set(id, { resolve, reject, timeout })
    })
  }

  close() {
    this.ws.close()
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception')
  return result.result?.value
}

async function waitFor(cdp, expression, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

function browserBootstrap(token) {
  return `
    (() => {
    window.__presenceHarnessErrors = [];
    window.__presenceHarnessRequests = [];
    window.__presenceHarnessHostId = Number(localStorage.getItem('na_presence_harness_host_id') || ${JSON.stringify(HOST_ID)});
    window.__presenceHarnessPerf = { longTasks: [] };
    try {
      new PerformanceObserver((list) => {
        window.__presenceHarnessPerf.longTasks.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })).slice(-50));
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
    window.addEventListener('error', (event) => {
      window.__presenceHarnessErrors.push({ type: 'error', message: event.message, source: event.filename, line: event.lineno });
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__presenceHarnessErrors.push({ type: 'unhandledrejection', reason: String(event.reason) });
    });
    localStorage.setItem('na_access_token', ${JSON.stringify(token)});
    localStorage.setItem('na_refresh_token', 'cdp-presence-refresh-placeholder');
    localStorage.setItem('na_hosts_display_mode', ${JSON.stringify(DISPLAY_MODE)});
    localStorage.setItem('na_hosts_default_view', 'all');

    const presenceHarnessHost = () => ({
      id: ${JSON.stringify(HOST_ID)},
      tenantId: ${TENANT_ID},
      name: 'presence-harness-host',
      description: null,
      ip: '10.30.0.10',
      port: 22,
      accessProtocol: 'ssh',
      operatingSystem: 'linux',
      sshUser: 'ops',
      authType: 'password',
      connectionMode: 'direct',
      privateAccessConnectorId: null,
      scope: 'global',
      groupId: null,
      folderId: null,
      inventoryNodeId: null,
      inventoryParentId: null,
      inventoryParentName: null,
      bastionId: null,
      pemKeyId: null,
      hasPasswordCredential: true,
      effectiveBastionId: null,
      effectiveBastionName: null,
      effectiveBastionSource: 'none',
      onePasswordRef: null,
      trustedHostKeyFingerprint: null,
      trustedHostKeyVerifiedAt: null,
      tags: [],
      associatedLinks: [],
      accessPermissions: { view: true, connect: true, edit: true, admin: true },
      createdAt: new Date().toISOString(),
    });
    const presenceHarnessFeatures = () => ({
      multiConnect: true,
      maxHosts: null,
      sessionAuditLicensed: true,
      sessionAuditAiLicensed: true,
      agentsLicensed: true,
      secretsLicensed: true,
      snippetsLicensed: true,
      portForwardingLicensed: true,
      integrationsLicensed: true,
      feedbackLicensed: true,
      localAiLicensed: true,
      mcpLicensed: true,
      aiSshActionsLicensed: true,
      integrationProviders: {},
      sharedSessions: { expiryMinutes: [15], maxExpiryMinutes: 60 },
    });
    const presenceHarnessAccessMap = () => {
      const hostId = Number(window.__presenceHarnessHostId || ${HOST_ID});
      return {
        generatedAt: new Date().toISOString(),
        refreshAfterSeconds: 5,
        totals: { activeSessions: 4, activeHosts: hostId ? 1 : 0, uniqueUsers: 3, concurrentHosts: hostId ? 1 : 0 },
        hosts: hostId ? [{
          host: {
            id: hostId,
            tenantId: ${TENANT_ID},
            name: 'presence-harness-host',
            ip: '10.30.0.10',
            port: 22,
            accessProtocol: 'SSH',
            scope: 'GLOBAL',
            groupName: null,
          },
          activeSessions: 4,
          uniqueUsers: 3,
          oldestStartedAt: new Date(Date.now() - 900000).toISOString(),
          lastStartedAt: new Date(Date.now() - 120000).toISOString(),
          lastSeenAt: new Date().toISOString(),
          sessions: [
            { id: 9101, user: { id: 101, name: 'Ada Lovelace', email: 'ada@example.local', avatarUrl: null, avatarVersion: null }, startedAt: new Date(Date.now() - 900000).toISOString(), lastSeenAt: new Date().toISOString(), durationSeconds: 900, connectionMethod: 'direct', accessType: 'authenticated', clientIp: '127.0.0.1', agentRemoteIp: null, agentNameSnapshot: null },
            { id: 9102, user: { id: 102, name: 'Linus Torvalds', email: 'linus@example.local', avatarUrl: null, avatarVersion: null }, startedAt: new Date(Date.now() - 600000).toISOString(), lastSeenAt: new Date().toISOString(), durationSeconds: 600, connectionMethod: 'direct', accessType: 'authenticated', clientIp: '127.0.0.1', agentRemoteIp: null, agentNameSnapshot: null },
            { id: 9103, user: { id: 103, name: 'Grace Hopper', email: 'grace@example.local', avatarUrl: null, avatarVersion: null }, startedAt: new Date(Date.now() - 300000).toISOString(), lastSeenAt: new Date().toISOString(), durationSeconds: 300, connectionMethod: 'direct', accessType: 'authenticated', clientIp: '127.0.0.1', agentRemoteIp: null, agentNameSnapshot: null },
            { id: 9104, user: { id: 102, name: 'Linus Torvalds', email: 'linus@example.local', avatarUrl: null, avatarVersion: null }, startedAt: new Date(Date.now() - 120000).toISOString(), lastSeenAt: new Date().toISOString(), durationSeconds: 120, connectionMethod: 'direct', accessType: 'authenticated', clientIp: '127.0.0.1', agentRemoteIp: null, agentNameSnapshot: null },
          ],
        }] : [],
      };
    };
    const presenceHarnessMock = (method, url) => {
      const normalizedMethod = String(method || 'GET').toUpperCase();
      const normalizedUrl = String(url || '');
      window.__presenceHarnessRequests.push({ method: normalizedMethod, url: normalizedUrl });
      if (normalizedMethod === 'GET' && /\\/api\\/v1\\/hosts(?:\\?|$)/.test(normalizedUrl)) {
        return { data: [presenceHarnessHost()], total: 1, page: 1, limit: 20 };
      }
      if (normalizedMethod === 'GET' && normalizedUrl.includes('/api/v1/features')) return presenceHarnessFeatures();
      if (normalizedMethod === 'GET' && normalizedUrl.includes('/api/v1/sessions/access-map')) return presenceHarnessAccessMap();
      return null;
    };

    const NativeFetch = window.fetch?.bind(window);
    if (NativeFetch) {
      window.fetch = async function patchedPresenceHarnessFetch(input, init) {
        const method = init?.method || (input && typeof input === 'object' && 'method' in input ? input.method : 'GET');
        const url = typeof input === 'string' ? input : input?.url;
        const payload = presenceHarnessMock(method, url);
        if (payload) {
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return NativeFetch(input, init);
      };
    }

    const NativeXhr = window.XMLHttpRequest;
    window.XMLHttpRequest = function PresenceHarnessXhr() {
      const xhr = new NativeXhr();
      let method = 'GET';
      let url = '';
      const nativeOpen = xhr.open;
      const nativeSend = xhr.send;
      xhr.open = function patchedOpen(nextMethod, nextUrl, ...rest) {
        method = String(nextMethod || 'GET').toUpperCase();
        url = String(nextUrl || '');
        return nativeOpen.call(xhr, nextMethod, nextUrl, ...rest);
      };
      xhr.send = function patchedSend(body) {
        const payload = presenceHarnessMock(method, url);
        if (payload) {
          setTimeout(() => {
            Object.defineProperty(xhr, 'readyState', { configurable: true, value: 4 });
            Object.defineProperty(xhr, 'status', { configurable: true, value: 200 });
            Object.defineProperty(xhr, 'statusText', { configurable: true, value: 'OK' });
            Object.defineProperty(xhr, 'responseText', { configurable: true, value: JSON.stringify(payload) });
            Object.defineProperty(xhr, 'response', { configurable: true, value: JSON.stringify(payload) });
            xhr.onreadystatechange?.();
            xhr.onload?.();
            xhr.onloadend?.();
          }, 20);
          return;
        }
        return nativeSend.call(xhr, body);
      };
      return xhr;
    };
    })();
  `
}

async function main() {
  const targets = await getJson(`${CDP_BASE}/json/list`)
  const target = targets.find((item) => item.type === 'page') || targets[0]
  if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP page target found at ${CDP_BASE}`)

  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const token = signJwt({
    sub: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: TENANT_ID,
    canManageHosts: true,
    canViewLiveSessions: true,
    forcePasswordChange: false,
    stage: 'authenticated',
    avatarUrl: null,
    avatarVersion: null,
  }, readJwtSecret())

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: browserBootstrap(token) })
  await cdp.send('Page.navigate', { url: `${FRONTEND}/hosts?presenceHarness=${Date.now()}` })
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await waitFor(cdp, `document.querySelector('[data-host-id]') || document.body.innerText.includes('Nenhum') || document.body.innerText.includes('No ')`, 15000)

  let hostId = await evaluate(cdp, `(() => {
    const el = document.querySelector('[data-host-id]');
    return el ? Number(el.getAttribute('data-host-id')) : ${JSON.stringify(HOST_ID)};
  })()`)
  if (!hostId) throw new Error('No host found to attach simulated presence. Set HOST_ID or create one visible host.')

  await evaluate(cdp, `window.__presenceHarnessHostId = ${JSON.stringify(hostId)}; localStorage.setItem('na_presence_harness_host_id', String(window.__presenceHarnessHostId)); location.reload(); true`)
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, a')]
      .filter((el) => /View all hosts|Ver todos os hosts|Todos os hosts|All hosts/.test(normalize(el.textContent)))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const target = candidates.find((el) => /View all hosts|Ver todos os hosts/.test(normalize(el.textContent))) || candidates[0];
    target?.click();
    return Boolean(target);
  })()`)
  await waitFor(cdp, `document.querySelector('[data-host-id]')`, 15000)
  hostId = await evaluate(cdp, `(() => {
    const el = document.querySelector('[data-host-id]');
    return el ? Number(el.getAttribute('data-host-id')) : ${JSON.stringify(hostId)};
  })()`)
  await evaluate(cdp, `window.__presenceHarnessHostId = ${JSON.stringify(hostId)}; localStorage.setItem('na_presence_harness_host_id', String(window.__presenceHarnessHostId)); location.reload(); true`)
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, a')]
      .filter((el) => /View all hosts|Ver todos os hosts|Todos os hosts|All hosts/.test(normalize(el.textContent)))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const target = candidates.find((el) => /View all hosts|Ver todos os hosts/.test(normalize(el.textContent))) || candidates[0];
    target?.click();
    return Boolean(target);
  })()`)
  await waitFor(cdp, `document.querySelector('[data-host-id="${hostId}"]')`, 15000)

  await evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, a')]
      .filter((el) => /View all hosts|Ver todos os hosts|Todos os hosts|All hosts/.test(normalize(el.textContent)))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const target = candidates.find((el) => /View all hosts|Ver todos os hosts/.test(normalize(el.textContent))) || candidates[0];
    target?.click();
    return Boolean(target);
  })()`)
  await waitFor(cdp, `document.body.innerText.includes('3 usuário(s)') || document.body.innerText.includes('3 user(s)')`, 15000)
  hostId = await evaluate(cdp, `(() => {
    const el = document.querySelector('[data-host-id]');
    return el ? Number(el.getAttribute('data-host-id')) : ${JSON.stringify(hostId)};
  })()`)

  const beforeHover = await evaluate(cdp, `(() => {
    const stack = document.querySelector('.host-presence-stack');
    const pill = stack?.closest('.n-tag') || [...document.querySelectorAll('*')]
      .filter((el) => {
        const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        return (text.includes('3 usuário(s)') || text.includes('3 user(s)')) && el.querySelector('.user-avatar');
      })
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
    if (!pill) return { found: false };
    const rect = pill.getBoundingClientRect();
    const overlaps = [...document.querySelectorAll('button, .n-tag, .n-button, .host-favorite-inline-button')]
      .filter((el) => el !== pill && !pill.contains(el) && !el.contains(pill))
      .map((el) => {
        const other = el.getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(rect.right, other.right) - Math.max(rect.left, other.left));
        const overlapY = Math.max(0, Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top));
        return { overlapArea: overlapX * overlapY, text: (el.textContent || '').replace(/\\s+/g, ' ').trim() };
      })
      .filter((item) => item.overlapArea > 4);
    return {
      found: true,
      text: pill.textContent.replace(/\\s+/g, ' ').trim(),
      avatarCount: pill.querySelectorAll('.user-avatar').length,
      overlapCount: overlaps.length,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`)
  if (!beforeHover.found) throw new Error('Presence pill was not rendered in the hosts list/cards')
  if (beforeHover.avatarCount < 3) throw new Error(`Expected 3 stacked avatars, got ${beforeHover.avatarCount}`)
  if (beforeHover.overlapCount > 0) throw new Error(`Presence pill overlaps ${beforeHover.overlapCount} interactive element(s)`)

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(beforeHover.rect.x + beforeHover.rect.width / 2),
    y: Math.round(beforeHover.rect.y + beforeHover.rect.height / 2),
  })
  await waitFor(cdp, `document.body.innerText.includes('Ada Lovelace') && document.body.innerText.includes('Linus Torvalds') && document.body.innerText.includes('Grace Hopper')`, 5000)
  const popoverHasUsers = await evaluate(cdp, `['Ada Lovelace', 'Linus Torvalds', 'Grace Hopper'].every((name) => document.body.innerText.includes(name))`)

  const connectClick = await evaluate(cdp, `(() => {
    const host = document.querySelector('[data-host-id="${hostId}"]');
    const button = host?.querySelector('[data-host-connect-button="true"]')
      || host?.querySelector('button.min-w-0.text-left')
      || host?.querySelector('[role="button"]')
      || [...(host?.querySelectorAll('button') || [])].find((el) => /Conectar|Connect/.test((el.textContent || '').trim()));
    if (!button) return {
      clicked: false,
      reason: 'connect-button-not-found',
      dataHostIds: [...document.querySelectorAll('[data-host-id]')].map((el) => el.getAttribute('data-host-id')).slice(0, 20),
      presenceTexts: [...document.querySelectorAll('.host-presence-stack')]
        .map((el) => (el.closest('.n-tag')?.textContent || el.textContent || '').replace(/\\s+/g, ' ').trim())
        .slice(0, 20),
      hostText: (host?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
      hostHtml: (host?.outerHTML || '').slice(0, 1200),
    };
    button.click();
    return { clicked: true };
  })()`)
  if (!connectClick.clicked) throw new Error(`Could not open a local terminal tab from host ${hostId}: ${JSON.stringify(connectClick)}`)

  await waitFor(cdp, `location.pathname.includes('/terminal')`, 5000)
  await evaluate(cdp, `history.back(); true`)
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, a')]
      .filter((el) => /View all hosts|Ver todos os hosts|Todos os hosts|All hosts/.test(normalize(el.textContent)))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const target = candidates.find((el) => /View all hosts|Ver todos os hosts/.test(normalize(el.textContent))) || candidates[0];
    target?.click();
    return Boolean(target);
  })()`)
  await waitFor(cdp, `document.querySelector('[data-open-sessions-panel="true"]')`, 15000)

  const openSessions = await evaluate(cdp, `(() => {
    const panel = document.querySelector('[data-open-sessions-panel="true"]');
    const items = [...document.querySelectorAll('[data-open-session-host-id]')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          hostId: Number(el.getAttribute('data-open-session-host-id')),
          text: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
          avatarCount: el.querySelectorAll('.user-avatar').length,
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((item) => item.visible);
    return {
      found: Boolean(panel),
      text: panel ? (panel.textContent || '').replace(/\\s+/g, ' ').trim() : '',
      itemCount: items.length,
      hostIds: items.map((item) => item.hostId),
      currentHostItems: items.filter((item) => item.hostId === ${JSON.stringify(hostId)}).length,
      foreignHostItems: items.filter((item) => item.hostId !== ${JSON.stringify(hostId)}).length,
      currentHostHasPresence: items
        .filter((item) => item.hostId === ${JSON.stringify(hostId)})
        .some((item) => item.avatarCount >= 3 && (item.text.includes('3 usuário(s)') || item.text.includes('3 user(s)'))),
    };
  })()`)
  if (!openSessions.found) throw new Error('Open sessions panel was not rendered after opening a local tab')
  if (openSessions.itemCount !== 1 || openSessions.currentHostItems !== 1) {
    throw new Error(`Expected exactly one current-host open session, got ${JSON.stringify(openSessions)}`)
  }
  if (openSessions.foreignHostItems > 0) {
    throw new Error(`Open sessions panel leaked sessions from other hosts: ${JSON.stringify(openSessions)}`)
  }
  if (!openSessions.currentHostHasPresence) {
    throw new Error(`Current-host open session did not render concurrent-user presence: ${JSON.stringify(openSessions)}`)
  }

  const report = await evaluate(cdp, `(() => {
    const longTasks = window.__presenceHarnessPerf?.longTasks || [];
    return {
      hostId: ${JSON.stringify(hostId)},
      displayMode: ${JSON.stringify(DISPLAY_MODE)},
      pillText: ${JSON.stringify(beforeHover.text)},
      stackedAvatars: ${JSON.stringify(beforeHover.avatarCount)},
      overlapCount: ${JSON.stringify(beforeHover.overlapCount)},
      popoverHasUsers: ${JSON.stringify(popoverHasUsers)},
      openSessions: ${JSON.stringify(openSessions)},
      nodeCount: document.getElementsByTagName('*').length,
      longTaskCount: longTasks.length,
      longTaskTotalMs: Math.round(longTasks.reduce((total, item) => total + item.duration, 0)),
      browserErrors: window.__presenceHarnessErrors || [],
    };
  })()`)

  const consoleErrors = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .slice(-20)
  const output = JSON.stringify({ frontend: FRONTEND, cdpBase: CDP_BASE, report, consoleErrors }, null, 2)
  if (REPORT_PATH) {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${output}\n`)
  }
  console.log(output)
  cdp.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
