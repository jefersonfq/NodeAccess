#!/usr/bin/env node
/*
 * Terminal interaction/layout harness with mocked API and SSH WebSocket.
 *
 * This exercises the browser UI without requiring a reachable backend or host.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9361 --user-data-dir=/tmp/nodeaccess-terminal-sim-cdp \
 *     --window-size=1440,1000 about:blank
 *
 *   FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9361 \
 *     node tools/frontend/terminal-cdp-simulated-flow.cjs
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const WebSocket = require('ws')

const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9361'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-cdp-simulated.json'

const HOST = {
  id: 9301,
  name: 'terminal-harness-host',
  ip: '10.30.0.10',
  port: 22,
  authType: 'password',
  accessProtocol: 'ssh',
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  return [
    base64Url({ alg: 'none', typ: 'JWT' }),
    base64Url({
      iat: now,
      exp: now + 3600,
      sub: '1',
      userId: 1,
      tenantId: 1,
      role: 'admin',
      email: 'admin@nodeaccess.local',
      name: 'Admin Harness',
      canManageHosts: true,
      canViewLiveSessions: true,
    }),
    'harness',
  ].join('.')
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

function requestJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function getPageWebSocketUrl() {
  try {
    const created = await requestJson(`${CDP_BASE}/json/new?${encodeURIComponent(`${FRONTEND}/about:blank`)}`, 'PUT')
    if (created?.webSocketDebuggerUrl) return created.webSocketDebuggerUrl
  } catch {
    // Fall back to an existing tab on older Chromium builds.
  }
  const targets = await getJson(`${CDP_BASE}/json`)
  const page = Array.isArray(targets)
    ? targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    : null
  if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page target found')
  return page.webSocketDebuggerUrl
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
      }, 20000)
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
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'Runtime exception'
    throw new Error(String(detail))
  }
  return result.result?.value
}

async function waitFor(cdp, expression, timeoutMs = 15000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url })
  await waitFor(cdp, 'document.readyState === "complete" || document.readyState === "interactive"', 15000)
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  })()`)
  if (!point) throw new Error(`Element not found for click: ${selector}`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

async function insertText(cdp, text) {
  await cdp.send('Input.insertText', { text })
}

async function setViewport(cdp, width, height, mobile = false) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  })
}

function mockScript() {
  const hostJson = JSON.stringify(HOST)
  const token = fakeJwt()
  return `
    (() => {
      const host = ${hostJson};
      const token = ${JSON.stringify(token)};
      const featurePayload = {
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
        sharedSessions: { expiryMinutes: [2, 5, 10, 30], maxExpiryMinutes: 30 },
      };
      const hostLinkOptions = {
        jitAccess: { enabled: true, expiryMinutes: [5, 15, 30], maxExpiryMinutes: 30, pinRequired: false },
      };
      const jsonFor = (url) => {
        const value = String(url || '');
        if (value.includes('/api/v1/features')) return featurePayload;
        if (value.includes('/api/v1/host-links/options')) return hostLinkOptions;
        if (value.includes('/api/v1/hosts/' + host.id)) return host;
        if (value.includes('/api/v1/hosts')) return { data: [host], pagination: { page: 1, limit: 50, total: 1, pages: 1 } };
        if (value.includes('/api/v1/session-audit')) return { data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } };
        return {};
      };

      window.__terminalHarness = {
        sent: [],
        resizeMessages: [],
        inputText: '',
        sockets: [],
        apiCalls: [],
        errors: [],
      };

      localStorage.setItem('na_access_token', token);
      localStorage.setItem('na_refresh_token', 'terminal-harness-refresh');
      sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(host));

      const originalFetch = window.fetch ? window.fetch.bind(window) : null;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input?.url;
        window.__terminalHarness.apiCalls.push({ method: init?.method || 'GET', url: String(url || '') });
        if (String(url || '').includes('/api/v1/')) {
          return new Response(JSON.stringify(jsonFor(url)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      };

      const OriginalXhr = window.XMLHttpRequest;
      window.XMLHttpRequest = function HarnessXMLHttpRequest() {
        const xhr = new OriginalXhr();
        let method = 'GET';
        let url = '';
        const open = xhr.open.bind(xhr);
        xhr.open = function patchedOpen(nextMethod, nextUrl, ...rest) {
          method = nextMethod;
          url = String(nextUrl);
          if (!url.includes('/api/v1/')) return open(nextMethod, nextUrl, ...rest);
        };
        const send = xhr.send.bind(xhr);
        xhr.send = function patchedSend() {
          if (!url.includes('/api/v1/')) return send(...arguments);
          window.__terminalHarness.apiCalls.push({ method, url });
          const payload = JSON.stringify(jsonFor(url));
          Object.defineProperty(xhr, 'readyState', { configurable: true, value: 4 });
          Object.defineProperty(xhr, 'status', { configurable: true, value: 200 });
          Object.defineProperty(xhr, 'statusText', { configurable: true, value: 'OK' });
          Object.defineProperty(xhr, 'responseText', { configurable: true, value: payload });
          Object.defineProperty(xhr, 'response', { configurable: true, value: payload });
          setTimeout(() => {
            xhr.onreadystatechange && xhr.onreadystatechange(new Event('readystatechange'));
            xhr.onload && xhr.onload(new Event('load'));
            xhr.onloadend && xhr.onloadend(new Event('loadend'));
          }, 0);
        };
        return xhr;
      };

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      class FakeTerminalWebSocket extends EventTarget {
        constructor(url) {
          super();
          this.url = String(url);
          this.isTerminalSocket = this.url.includes('/ws/ssh/');
          this.readyState = FakeTerminalWebSocket.CONNECTING;
          this.binaryType = 'arraybuffer';
          window.__terminalHarness.sockets.push(this.url);
          setTimeout(() => {
            this.readyState = FakeTerminalWebSocket.OPEN;
            this.onopen && this.onopen(new Event('open'));
            if (!this.isTerminalSocket) return;
            this.emitText(JSON.stringify({
              type: 'connected',
              sessionId: 99001,
              hostName: host.name,
              connectionMethod: 'direct',
              agentName: null,
            }));
            this.emitBytes('Terminal harness ready\\r\\n$ printf "alpha beta gamma"\\r\\nalpha beta gamma\\r\\n$ ');
          }, 40);
        }
        send(data) {
          let decoded = '';
          if (typeof data === 'string') decoded = data;
          else if (data instanceof ArrayBuffer) decoded = decoder.decode(new Uint8Array(data));
          else if (ArrayBuffer.isView(data)) decoded = decoder.decode(data);
          window.__terminalHarness.sent.push(decoded);
          try {
            const msg = JSON.parse(decoded);
            if (msg.type === 'resize') window.__terminalHarness.resizeMessages.push(msg);
            if (msg.type === 'ping') this.emitText(JSON.stringify({ type: 'pong' }));
            return;
          } catch {}
          if (decoded) {
            window.__terminalHarness.inputText += decoded;
            this.emitBytes(decoded.replace(/\\r/g, '\\r\\n') + '$ ');
          }
        }
        close() {
          this.readyState = FakeTerminalWebSocket.CLOSED;
          this.onclose && this.onclose(new CloseEvent('close'));
        }
        emitText(text) {
          const event = new MessageEvent('message', { data: text });
          this.onmessage && this.onmessage(event);
        }
        emitBytes(text) {
          const event = new MessageEvent('message', { data: encoder.encode(text).buffer });
          this.onmessage && this.onmessage(event);
        }
      }
      FakeTerminalWebSocket.CONNECTING = 0;
      FakeTerminalWebSocket.OPEN = 1;
      FakeTerminalWebSocket.CLOSING = 2;
      FakeTerminalWebSocket.CLOSED = 3;
      window.WebSocket = FakeTerminalWebSocket;

      window.addEventListener('error', (event) => {
        window.__terminalHarness.errors.push(String(event.message || event.error || 'error'));
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__terminalHarness.errors.push(String(event.reason?.message || event.reason || 'unhandledrejection'));
      });
    })();
  `
}

async function collectSnapshot(cdp, label) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const container = document.querySelector('[data-terminal-container="true"]');
    const xterm = document.querySelector('.xterm');
    const screen = document.querySelector('.xterm-screen');
    const textarea = document.querySelector('.xterm-helper-textarea');
    const toolbarVisible = Boolean(document.querySelector('[data-terminal-action="hide-toolbar"]'));
    const floatingToolbarVisible = Boolean(document.querySelector('[data-terminal-action="show-toolbar"]'));
    const searchBar = document.querySelector('[data-terminal-search-bar="true"]');
    const copyMode = document.querySelector('[data-terminal-copy-mode="true"]');
    const info = document.querySelector('[data-terminal-info="true"]');
    const rect = container?.getBoundingClientRect();
    const screenRect = screen?.getBoundingClientRect();
    const doc = document.documentElement;
    const body = document.body;
    const overflowX = Math.max(doc.scrollWidth, body.scrollWidth) - window.innerWidth;
    const interactiveControls = [...document.querySelectorAll('[data-terminal-action]')].map((el) => ({
      action: el.getAttribute('data-terminal-action'),
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    }));
    return {
      label: ${JSON.stringify(label)},
      href: location.href,
      bodyText: document.body.innerText.slice(0, 1500),
      viewport: { width: window.innerWidth, height: window.innerHeight, overflowX },
      hasTerminal: Boolean(container && xterm && screen),
      terminalText: normalize(document.querySelector('.xterm-rows')?.textContent || document.body.innerText),
      container: rect ? {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        rows: Number(container?.getAttribute('data-terminal-rows') || 0),
        cols: Number(container?.getAttribute('data-terminal-cols') || 0),
        dataWidth: Number(container?.getAttribute('data-terminal-width') || 0),
        dataHeight: Number(container?.getAttribute('data-terminal-height') || 0),
        resizeSentAt: container?.getAttribute('data-terminal-resize-sent-at') || null,
      } : null,
      screen: screenRect ? { width: Math.round(screenRect.width), height: Math.round(screenRect.height) } : null,
      toolbarVisible,
      floatingToolbarVisible,
      searchBarVisible: Boolean(searchBar),
      copyModeVisible: Boolean(copyMode),
      infoVisible: Boolean(info),
      focused: document.activeElement ? {
        tag: document.activeElement.tagName,
        action: document.activeElement.getAttribute?.('data-terminal-action') || null,
        className: String(document.activeElement.className || ''),
      } : null,
      textareaHidden: textarea ? {
        left: getComputedStyle(textarea).left,
        opacity: getComputedStyle(textarea).opacity,
        width: getComputedStyle(textarea).width,
        height: getComputedStyle(textarea).height,
      } : null,
      interactiveControls,
      harness: window.__terminalHarness ? {
        sockets: window.__terminalHarness.sockets,
        resizeMessages: window.__terminalHarness.resizeMessages,
        sent: window.__terminalHarness.sent.slice(-20),
        inputText: window.__terminalHarness.inputText,
        apiCalls: window.__terminalHarness.apiCalls,
        errors: window.__terminalHarness.errors,
      } : null,
    };
  })()`)
}

function assertSnapshot(snapshot, findings, options = {}) {
  const minWidth = options.minWidth ?? 320
  const minHeight = options.minHeight ?? 280
  const minCols = options.minCols ?? 40
  const minRows = options.minRows ?? 10
  if (!snapshot.hasTerminal) findings.push(`${snapshot.label}: terminal/xterm nao renderizado`)
  if ((snapshot.container?.width || 0) < minWidth) findings.push(`${snapshot.label}: largura util baixa (${snapshot.container?.width || 0}px)`)
  if ((snapshot.container?.height || 0) < minHeight) findings.push(`${snapshot.label}: altura util baixa (${snapshot.container?.height || 0}px)`)
  if ((snapshot.container?.cols || 0) < minCols) findings.push(`${snapshot.label}: cols abaixo do minimo (${snapshot.container?.cols || 0})`)
  if ((snapshot.container?.rows || 0) < minRows) findings.push(`${snapshot.label}: rows abaixo do minimo (${snapshot.container?.rows || 0})`)
  if (snapshot.viewport.overflowX > 2) findings.push(`${snapshot.label}: overflow horizontal de ${snapshot.viewport.overflowX}px`)
  if (!snapshot.textareaHidden) findings.push(`${snapshot.label}: helper textarea do xterm nao encontrado`)
  if (snapshot.textareaHidden && snapshot.textareaHidden.opacity !== '0') {
    findings.push(`${snapshot.label}: helper textarea visivel (opacity ${snapshot.textareaHidden.opacity})`)
  }
}

async function main() {
  const cdp = new Cdp(await getPageWebSocketUrl())
  const findings = []
  const snapshots = {}

  try {
    await cdp.open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript() })
    await setViewport(cdp, 1440, 1000)

    await navigate(cdp, `${FRONTEND}/terminal?terminalHarness=${Date.now()}`)
    await waitFor(cdp, `document.querySelector('[data-terminal-container="true"]')`, 20000)
    await waitFor(cdp, `document.querySelector('.xterm-screen')`, 20000)
    await waitFor(cdp, `window.__terminalHarness?.resizeMessages?.length > 0`, 10000)
    await waitFor(cdp, `document.body.innerText.includes('Terminal harness ready') || document.querySelector('.xterm-rows')`, 10000)
    await new Promise((resolve) => setTimeout(resolve, 500))

    snapshots.initial = await collectSnapshot(cdp, 'desktop-initial')
    assertSnapshot(snapshots.initial, findings)
    if (!snapshots.initial.toolbarVisible) findings.push('desktop-initial: toolbar principal nao esta visivel')
    if (!snapshots.initial.harness?.sockets?.some((url) => url.includes(`/ws/ssh/${HOST.id}`))) {
      findings.push('desktop-initial: WebSocket SSH nao foi aberto para o host esperado')
    }
    if (!snapshots.initial.harness?.resizeMessages?.length) {
      findings.push('desktop-initial: resize inicial nao foi enviado ao WebSocket')
    }

    await click(cdp, '[data-terminal-action="find"]')
    await waitFor(cdp, `document.querySelector('[data-terminal-search-bar="true"]')`, 5000)
    await insertText(cdp, 'alpha')
    snapshots.searchOpen = await collectSnapshot(cdp, 'search-open')
    if (!snapshots.searchOpen.searchBarVisible) findings.push('search-open: barra de busca nao abriu')
    if (snapshots.searchOpen.focused?.tag !== 'INPUT') findings.push('search-open: input de busca nao recebeu foco')

    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await waitFor(cdp, `!document.querySelector('[data-terminal-search-bar="true"]')`, 5000)

    await click(cdp, '[data-terminal-action="info"]')
    await waitFor(cdp, `document.querySelector('[data-terminal-info="true"]')`, 5000)
    snapshots.infoOpen = await collectSnapshot(cdp, 'info-open')
    if (!snapshots.infoOpen.infoVisible) findings.push('info-open: painel de info nao abriu')
    if (!snapshots.infoOpen.bodyText.includes(HOST.name) || !snapshots.infoOpen.bodyText.includes(HOST.ip)) {
      findings.push('info-open: painel de info nao mostra host/IP')
    }

    await click(cdp, '[data-terminal-action="copy-mode"]')
    await waitFor(cdp, `document.querySelector('[data-terminal-copy-mode="true"]')`, 5000)
    snapshots.copyMode = await collectSnapshot(cdp, 'copy-mode')
    if (!snapshots.copyMode.copyModeVisible) findings.push('copy-mode: modo texto nao abriu')
    if (!/alpha beta gamma|Terminal harness ready/.test(snapshots.copyMode.bodyText)) {
      findings.push('copy-mode: buffer do terminal nao apareceu no modo texto')
    }
    await click(cdp, '[data-terminal-action="close-copy-mode"]')
    await waitFor(cdp, `!document.querySelector('[data-terminal-copy-mode="true"]')`, 5000)

    await click(cdp, '[data-terminal-action="hide-toolbar"]')
    await waitFor(cdp, `document.querySelector('[data-terminal-action="show-toolbar"]')`, 5000)
    snapshots.toolbarHidden = await collectSnapshot(cdp, 'toolbar-hidden')
    if (!snapshots.toolbarHidden.floatingToolbarVisible) findings.push('toolbar-hidden: controle flutuante para restaurar toolbar nao apareceu')
    await click(cdp, '[data-terminal-action="show-toolbar"]')
    await waitFor(cdp, `document.querySelector('[data-terminal-action="hide-toolbar"]')`, 5000)

    await click(cdp, '[data-terminal-action="tab-search"]')
    await waitFor(cdp, `document.querySelector('[data-terminal-tab-search-input="true"]')`, 5000)
    snapshots.tabSearch = await collectSnapshot(cdp, 'tab-search')
    if (!snapshots.tabSearch.bodyText.includes(HOST.name)) findings.push('tab-search: resultado nao mostra host atual')

    await evaluate(cdp, `document.querySelector('.xterm-helper-textarea')?.focus()`)
    await insertText(cdp, 'echo harness-input\\r')
    await waitFor(cdp, `window.__terminalHarness?.inputText?.includes('echo harness-input')`, 5000)
    snapshots.afterInput = await collectSnapshot(cdp, 'after-input')
    if (!snapshots.afterInput.harness?.inputText?.includes('echo harness-input')) {
      findings.push('after-input: digitacao nao chegou ao WebSocket')
    }

    await setViewport(cdp, 390, 860, true)
    await new Promise((resolve) => setTimeout(resolve, 900))
    snapshots.mobile = await collectSnapshot(cdp, 'mobile')
    assertSnapshot(snapshots.mobile, findings, { minWidth: 240, minHeight: 280, minCols: 30, minRows: 10 })
    if (snapshots.mobile.viewport.overflowX > 2) {
      findings.push(`mobile: terminal criou overflow horizontal (${snapshots.mobile.viewport.overflowX}px)`)
    }

    const harnessErrors = snapshots.mobile.harness?.errors || snapshots.afterInput.harness?.errors || []
    if (harnessErrors.length) findings.push(`Erros JS durante harness: ${harnessErrors.join(' | ')}`)

    const report = {
      ok: findings.length === 0,
      startedAt: new Date().toISOString(),
      frontend: FRONTEND,
      cdp: CDP_BASE,
      host: HOST,
      findings,
      snapshots,
      finishedAt: new Date().toISOString(),
    }

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({
      ok: report.ok,
      reportPath: REPORT_PATH,
      findings,
      snapshots: Object.fromEntries(Object.entries(snapshots).map(([key, value]) => [key, {
        viewport: value.viewport,
        container: value.container,
        toolbarVisible: value.toolbarVisible,
        searchBarVisible: value.searchBarVisible,
        copyModeVisible: value.copyModeVisible,
        infoVisible: value.infoVisible,
      }])),
    }, null, 2))
    if (!report.ok) process.exit(1)
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
