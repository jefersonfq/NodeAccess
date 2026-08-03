#!/usr/bin/env node
/*
 * Hosts sidebar UX/performance check via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9343 --user-data-dir=/tmp/nodeaccess-sidebar-ux \
 *     --window-size=1440,1000 about:blank
 *
 *   node tools/frontend/sidebar-cdp-ux.cjs
 *
 * Useful env vars:
 *   FRONTEND_BASE=http://127.0.0.1:5173
 *   CDP_BASE=http://127.0.0.1:9343
 *   ADMIN_USER_ID=1
 *   ADMIN_EMAIL=admin@nodeaccess.local
 *   TENANT_ID=1
 *   REPORT_PATH=/tmp/nodeaccess-sidebar-ux.json
 *   POST_ACTION_WAIT_MS=900
 *   SIDEBAR_SEARCH=prod
 *   SIDEBAR_SCENARIO_SET=smoke|extended
 *   SIDEBAR_UX_AUDIT=1
 *   SIDEBAR_UX_VIEWPORTS=1440x1000,1024x900,390x844
 *   SIDEBAR_SCREENSHOT_DIR=/tmp/nodeaccess-sidebar-shots
 *
 * Optional mutating checks are disabled by default:
 *   SIDEBAR_MUTATE=1
 *   SIDEBAR_DRAG_FROM_HOST_ID=123
 *   SIDEBAR_DRAG_TO_FOLDER_TEXT=Destino
 *   SIDEBAR_CREATE_TEST_FOLDERS=1
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9343'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '1'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nodeaccess.local'
const TENANT_ID = Number(process.env.TENANT_ID || '1')
const POST_ACTION_WAIT_MS = Number(process.env.POST_ACTION_WAIT_MS || '900')
const SIDEBAR_SEARCH = process.env.SIDEBAR_SEARCH || ''
const SIDEBAR_SCENARIO_SET = process.env.SIDEBAR_SCENARIO_SET || 'smoke'
const SIDEBAR_UX_AUDIT = process.env.SIDEBAR_UX_AUDIT !== '0'
const SIDEBAR_UX_VIEWPORTS = (process.env.SIDEBAR_UX_VIEWPORTS || '1440x1000,1024x900,390x844')
  .split(',')
  .map((item) => {
    const [width, height] = item.toLowerCase().split('x').map((value) => Number(value.trim()))
    return width > 0 && height > 0 ? { width, height } : null
  })
  .filter(Boolean)
const SIDEBAR_SCREENSHOT_DIR = process.env.SIDEBAR_SCREENSHOT_DIR || ''
const SIDEBAR_MUTATE = process.env.SIDEBAR_MUTATE === '1'
const SIDEBAR_CREATE_TEST_FOLDERS = process.env.SIDEBAR_CREATE_TEST_FOLDERS === '1'
const SIDEBAR_DRAG_FROM_HOST_ID = Number(process.env.SIDEBAR_DRAG_FROM_HOST_ID || '0')
let SIDEBAR_DRAG_TO_FOLDER_TEXT = process.env.SIDEBAR_DRAG_TO_FOLDER_TEXT || ''
const HOSTS_VIEW_PATH = path.join(REPO_ROOT, 'apps/frontend/src/views/HostsView.vue')

function readJwtSecret() {
  const envPath = process.env.BACKEND_ENV_PATH || path.join(REPO_ROOT, 'apps/backend/.env')
  const envFile = fs.readFileSync(envPath, 'utf8')
  const match = envFile.match(/^JWT_SECRET=(.+)$/m)
  if (!match) throw new Error(`JWT_SECRET not found in ${envPath}`)
  return match[1].trim().replace(/^"|"$/g, '')
}

function runStaticInventoryTreeKeyChecks() {
  const source = fs.readFileSync(HOSTS_VIEW_PATH, 'utf8')
  const checks = [
    {
      name: 'corporate-folders-use-inventory-folder-prefix',
      ok: /key:\s*node\.type === 'HOST' \? `host-\$\{node\.hostId \?\? node\.id\}` : `inventory-folder-\$\{node\.id\}`/.test(source),
      severity: 'high',
      message: 'A arvore de ACL corporativa deve usar inventory-folder-{id}, nao folder-{id}.',
    },
    {
      name: 'selected-key-maps-to-inventory-folder-prefix',
      ok: /return \[`inventory-folder-\$\{selectedKey\.value\.replace\('inventory-', ''\)\}`\]/.test(source),
      severity: 'high',
      message: 'A selecao inventory-{id} deve destacar inventory-folder-{id} na arvore.',
    },
    {
      name: 'tree-selection-maps-back-to-inventory-key',
      ok: /if \(key\.startsWith\('inventory-folder-'\)\) \{\s*search\.value = ''\s*selectedKey\.value = `inventory-\$\{key\.replace\('inventory-folder-', ''\)\}`/s.test(source),
      severity: 'high',
      message: 'Clique na pasta corporativa deve voltar para selectedKey inventory-{id}.',
    },
    {
      name: 'corporate-tree-does-not-emit-personal-folder-prefix',
      ok: !/node\.type === 'HOST' \? `host-\$\{node\.hostId \?\? node\.id\}` : `folder-\$\{node\.id\}`/.test(source),
      severity: 'high',
      message: 'A arvore corporativa nao pode emitir folder-{id}; esse prefixo pertence a pastas pessoais.',
    },
  ]
  return {
    checked: path.relative(REPO_ROOT, HOSTS_VIEW_PATH),
    ok: checks.every((check) => check.ok),
    checks,
  }
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
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'Runtime exception'
    throw new Error(String(detail))
  }
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

function sanitizeFilePart(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'shot'
}

async function captureScreenshot(cdp, label) {
  if (!SIDEBAR_SCREENSHOT_DIR) return null
  fs.mkdirSync(SIDEBAR_SCREENSHOT_DIR, { recursive: true })
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  const filePath = path.join(SIDEBAR_SCREENSHOT_DIR, `${sanitizeFilePart(label)}.png`)
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'))
  return filePath
}

function summarizeNetwork(events) {
  const requests = new Map()
  const responses = new Map()
  const finishes = new Map()
  const failures = []
  for (const event of events) {
    const params = event.params || {}
    const requestId = params.requestId
    if (event.method === 'Network.requestWillBeSent' && params.request?.url?.includes('/api/')) {
      requests.set(requestId, {
        requestId,
        url: params.request.url,
        method: params.request.method,
        startedAt: event.at,
      })
    } else if (event.method === 'Network.responseReceived' && requestId && params.response?.url?.includes('/api/')) {
      responses.set(requestId, {
        status: params.response.status,
        fromDiskCache: !!params.response.fromDiskCache,
        fromServiceWorker: !!params.response.fromServiceWorker,
      })
    } else if (event.method === 'Network.loadingFinished' && requestId) {
      finishes.set(requestId, {
        finishedAt: event.at,
        encodedDataLength: params.encodedDataLength,
      })
    } else if (event.method === 'Network.loadingFailed' && requestId) {
      failures.push({ requestId, errorText: params.errorText, canceled: !!params.canceled })
    }
  }

  return {
    calls: Array.from(requests.values()).map((request) => {
      const response = responses.get(request.requestId)
      const finish = finishes.get(request.requestId)
      return {
        method: request.method,
        url: request.url.replace(FRONTEND, ''),
        status: response?.status ?? null,
        durationMs: finish ? finish.finishedAt - request.startedAt : null,
        encodedDataLength: finish?.encodedDataLength ?? null,
        fromDiskCache: response?.fromDiskCache ?? false,
        fromServiceWorker: response?.fromServiceWorker ?? false,
      }
    }),
    failures,
  }
}

async function resetPerf(cdp) {
  await evaluate(cdp, `(() => {
    window.__sidebarPerf = window.__sidebarPerf || {};
    window.__sidebarPerf.mutationCount = 0;
    window.__sidebarPerf.longTasks = [];
    window.__sidebarPerf.layoutShifts = [];
  })()`)
}

async function snapshot(cdp, label) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const perf = window.__sidebarPerf || {};
    const longTasks = perf.longTasks || [];
    const layoutShifts = perf.layoutShifts || [];
    const treeNodes = [...document.querySelectorAll('.inventory-sidebar-tree .n-tree-node')];
    const folderNodes = [...document.querySelectorAll('.inventory-folder-node-label')];
    const hostNodes = [...document.querySelectorAll('.inventory-host-node-label')];
    const contextOptions = [...document.querySelectorAll('.n-dropdown-option-body')]
      .map((el) => normalize(el.textContent))
      .filter(Boolean);
    const visibleModals = [...document.querySelectorAll('.n-modal, .n-drawer')]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length;
    const memory = performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null;
    return {
      label: ${JSON.stringify(label)},
      at: Math.round(performance.now()),
      sidebarItems: document.querySelectorAll('.sidebar-item').length,
      inventoryTreeNodes: treeNodes.length,
      inventoryFolderNodes: folderNodes.length,
      inventoryHostNodes: hostNodes.length,
      activeSidebar: [...document.querySelectorAll('.sidebar-item--active')].map((el) => normalize(el.textContent))[0] || null,
      hostCards: document.querySelectorAll('.host-card').length,
      hostRows: document.querySelectorAll('tbody tr').length,
      nodeCount: document.getElementsByTagName('*').length,
      contextOptions,
      visibleModals,
      mutationCount: perf.mutationCount || 0,
      longTaskCount: longTasks.length,
      longTaskTotalMs: Math.round(longTasks.reduce((total, item) => total + item.duration, 0)),
      longestLongTaskMs: Math.round(longTasks.reduce((max, item) => Math.max(max, item.duration, 0), 0)),
      layoutShiftCount: layoutShifts.length,
      layoutShiftTotal: Number(layoutShifts.reduce((total, item) => total + item.value, 0).toFixed(4)),
      memory,
      bodyStart: document.body.innerText.slice(0, 300),
    };
  })()`)
}

async function uxSnapshot(cdp, label) {
  const metrics = await evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const describe = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        text: normalize(el.textContent).slice(0, 120),
        title: el.getAttribute('title') || '',
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        className: String(el.className || '').slice(0, 140),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    };
    const sidebarRoot = document.querySelector('.inventory-sidebar-tree')
      ?.closest('aside, nav, [class*="sidebar"], [class*="Sidebar"], .n-layout-sider')
      || document.querySelector('.inventory-sidebar-tree')
      || document.querySelector('.sidebar-item')?.parentElement
      || null;
    const sidebarRect = sidebarRoot ? sidebarRoot.getBoundingClientRect() : null;
    const textCandidates = [...document.querySelectorAll([
      '.sidebar-item',
      '.inventory-folder-node-label',
      '.inventory-host-node-label',
      '.inventory-folder-node-text',
      '.n-dropdown-option-body',
      '.n-tree-node-content__text',
      'button',
    ].join(','))].filter(visible);
    const overflowedText = textCandidates
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .map((el) => ({
        ...describe(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }))
      .slice(0, 20);
    const targetCandidates = [...document.querySelectorAll([
      'button',
      'a',
      '[role="button"]',
      '[role="treeitem"]',
      '.sidebar-item',
      '.n-tree-node-content',
      '.n-dropdown-option-body',
    ].join(','))].filter(visible);
    const smallTargets = targetCandidates
      .map(describe)
      .filter((item) => item.rect.width < 32 || item.rect.height < 28)
      .slice(0, 24);
    const overlays = [...document.querySelectorAll('.n-dropdown-menu, .n-popover, .n-modal, .n-drawer, .n-dialog')]
      .filter(visible)
      .map((el) => {
        const item = describe(el);
        return {
          ...item,
          offscreen: item.rect.x < 0
            || item.rect.y < 0
            || item.rect.x + item.rect.width > window.innerWidth
            || item.rect.y + item.rect.height > window.innerHeight,
        };
      });
    const panelHeaders = [...document.querySelectorAll('.sidebar-panel-toggle')]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const title = el.querySelector('.sidebar-panel-title');
        const chevron = el.querySelector('.sidebar-panel-chevron');
        const badge = el.querySelector('.sidebar-panel-count, .sidebar-panel-action, [class*="badge"]');
        const titleRect = title ? title.getBoundingClientRect() : null;
        const chevronRect = chevron ? chevron.getBoundingClientRect() : null;
        const badgeRect = badge ? badge.getBoundingClientRect() : null;
        return {
          text: normalize(el.textContent),
          headerX: Math.round(rect.x),
          titleX: titleRect ? Math.round(titleRect.x) : null,
          chevronX: chevronRect ? Math.round(chevronRect.x) : null,
          badgeX: badgeRect ? Math.round(badgeRect.x) : null,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
    const panelTitleXs = panelHeaders.map((item) => item.titleX).filter((value) => Number.isFinite(value));
    const panelChevronXs = panelHeaders.map((item) => item.chevronX).filter((value) => Number.isFinite(value));
    const panelTitleDelta = panelTitleXs.length ? Math.max(...panelTitleXs) - Math.min(...panelTitleXs) : 0;
    const panelChevronDelta = panelChevronXs.length ? Math.max(...panelChevronXs) - Math.min(...panelChevronXs) : 0;
    const panelHeaderAlignment = {
      ok: panelHeaders.length < 2
        || (panelTitleDelta <= 3 && panelChevronDelta <= 3),
      maxTitleDeltaPx: panelTitleDelta,
      maxChevronDeltaPx: panelChevronDelta,
      headers: panelHeaders,
    };
    const active = document.activeElement && document.activeElement !== document.body
      ? describe(document.activeElement)
      : null;
    const activeStyle = document.activeElement && document.activeElement !== document.body
      ? getComputedStyle(document.activeElement)
      : null;
    return {
      label: ${JSON.stringify(label)},
      viewport: { width: window.innerWidth, height: window.innerHeight },
      sidebarRect: sidebarRect
        ? {
            x: Math.round(sidebarRect.x),
            y: Math.round(sidebarRect.y),
            width: Math.round(sidebarRect.width),
            height: Math.round(sidebarRect.height),
          }
        : null,
      density: sidebarRect
        ? {
            visibleFolderNodes: document.querySelectorAll('.inventory-folder-node-label').length,
            visibleHostNodes: document.querySelectorAll('.inventory-host-node-label').length,
            visibleTreeNodes: document.querySelectorAll('.inventory-sidebar-tree .n-tree-node').length,
            treeNodesPer100Px: Number((document.querySelectorAll('.inventory-sidebar-tree .n-tree-node').length / Math.max(1, sidebarRect.height / 100)).toFixed(2)),
          }
        : null,
      overflowedText,
      smallTargets,
      overlays,
      panelHeaderAlignment,
      activeElement: active,
      activeFocusStyle: activeStyle
        ? {
            outlineStyle: activeStyle.outlineStyle,
            outlineWidth: activeStyle.outlineWidth,
            boxShadow: activeStyle.boxShadow,
          }
        : null,
    };
  })()`)
  metrics.screenshot = await captureScreenshot(cdp, `sidebar-${label}-${metrics.viewport.width}x${metrics.viewport.height}`)
  return metrics
}

function buildUxFindings(uxSnapshots, keyboardChecks) {
  const findings = []
  for (const item of uxSnapshots) {
    if (item.overflowedText?.length) {
      const overflowWithoutTooltip = item.overflowedText.filter((entry) => !entry.title)
      if (!overflowWithoutTooltip.length) continue
      findings.push({
        severity: 'medium',
        label: item.label,
        issue: 'Texto com overflow ou corte visual sem tooltip/title de apoio.',
        evidence: overflowWithoutTooltip.slice(0, 5),
      })
    }
    const actionableSmallTargets = (item.smallTargets || []).filter((target) => {
      const text = target.text.toLowerCase()
      return target.text || target.role || text.includes('host') || text.includes('pasta')
    })
    if (actionableSmallTargets.length) {
      findings.push({
        severity: 'low',
        label: item.label,
        issue: 'Alguns alvos interativos estão abaixo de 32x28px.',
        evidence: actionableSmallTargets.slice(0, 6),
      })
    }
    const offscreenOverlays = (item.overlays || []).filter((overlay) => overlay.offscreen)
    if (offscreenOverlays.length) {
      findings.push({
        severity: 'high',
        label: item.label,
        issue: 'Menu, modal ou overlay ficou fora da viewport.',
        evidence: offscreenOverlays.slice(0, 4),
      })
    }
    if (item.sidebarRect && item.sidebarRect.width < 220 && item.viewport.width >= 768) {
      findings.push({
        severity: 'low',
        label: item.label,
        issue: 'Sidebar estreito para desktop/tablet; aumenta risco de truncamento em nomes longos.',
        evidence: { sidebarRect: item.sidebarRect, viewport: item.viewport },
      })
    }
    if (item.panelHeaderAlignment && !item.panelHeaderAlignment.ok) {
      findings.push({
        severity: 'medium',
        label: item.label,
        issue: 'Headers do sidebar desalinhados entre paineis.',
        evidence: item.panelHeaderAlignment,
      })
    }
  }
  const failedKeyboard = (keyboardChecks || []).filter((item) => !item.ok)
  if (failedKeyboard.length) {
    findings.push({
      severity: 'medium',
      label: 'keyboard-navigation',
      issue: 'Navegação por teclado não encontrou foco útil no sidebar.',
      evidence: failedKeyboard,
    })
  }
  return findings
}

function buildAclSidebarFindings(staticChecks, scenarios) {
  const findings = []
  for (const check of staticChecks.checks || []) {
    if (!check.ok) {
      findings.push({
        severity: check.severity || 'high',
        label: `static:${check.name}`,
        issue: check.message,
      })
    }
  }

  const corporateNavigation = scenarios.find((scenario) => scenario.label === 'navigate-first-corporate-folder')
  if (!corporateNavigation) return findings
  if (corporateNavigation.action?.ok === false) {
    findings.push({
      severity: 'low',
      label: 'navigate-first-corporate-folder',
      issue: 'Nao havia pasta corporativa visivel para validar selecao no navegador.',
      evidence: corporateNavigation.action,
    })
    return findings
  }

  const apiUrls = (corporateNavigation.network?.calls || []).map((call) => call.url)
  const hostListUrls = apiUrls.filter((url) => url.includes('/api/v1/hosts?') || url.includes('/api/v1/hosts&'))
  const usesInventoryNodeId = apiUrls.some((url) => url.includes('inventoryNodeId='))
  const leaksPersonalFolderId = hostListUrls.some((url) => url.includes('folderId='))
  if (!usesInventoryNodeId || leaksPersonalFolderId) {
    findings.push({
      severity: 'high',
      label: 'navigate-first-corporate-folder',
      issue: 'Clique em pasta corporativa deve filtrar por inventoryNodeId e nao por folderId pessoal.',
      evidence: {
        usesInventoryNodeId,
        leaksPersonalFolderId,
        apiUrls: apiUrls.slice(0, 12),
      },
    })
  }
  return findings
}

async function measure(cdp, label, actionExpression) {
  const startEventIndex = cdp.events.length
  await resetPerf(cdp)
  const before = await snapshot(cdp, `${label}:before`)
  const started = Date.now()
  const action = await evaluate(cdp, actionExpression)
  await new Promise((resolve) => setTimeout(resolve, POST_ACTION_WAIT_MS))
  const after = await snapshot(cdp, `${label}:after`)
  const events = cdp.events.slice(startEventIndex)
  return {
    label,
    action,
    observationMs: Date.now() - started,
    network: summarizeNetwork(events),
    before,
    after,
    deltas: {
      nodeCount: after.nodeCount - before.nodeCount,
      mutationCount: after.mutationCount,
      longTaskCount: after.longTaskCount,
      longTaskTotalMs: after.longTaskTotalMs,
      layoutShiftTotal: after.layoutShiftTotal,
      inventoryTreeNodes: after.inventoryTreeNodes - before.inventoryTreeNodes,
      inventoryHostNodes: after.inventoryHostNodes - before.inventoryHostNodes,
    },
  }
}

async function closeOverlays(cdp) {
  await evaluate(cdp, `(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    return true;
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 250))
}

function pressEscapeExpression() {
  return `(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    return { ok: true };
  })()`
}

function overlayStateExpression() {
  return `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const dropdownOptions = [...document.querySelectorAll('.n-dropdown-option-body')]
      .map((el) => normalize(el.textContent))
      .filter(Boolean);
    const dialogs = [...document.querySelectorAll('.n-dialog, .n-modal, .n-drawer')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { text: normalize(el.textContent).slice(0, 240), visible: rect.width > 0 && rect.height > 0 };
      })
      .filter((item) => item.visible);
    return {
      ok: true,
      dropdownOptions,
      visibleOverlayCount: dropdownOptions.length > 0 ? 1 : 0,
      visibleDialogs: dialogs,
      visibleDialogCount: dialogs.length,
    };
  })()`
}

function clickTextExpression(text) {
  return `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, .sidebar-item, [role="button"], a, .n-dropdown-option-body, div, span')]
      .map((el) => ({ el, text: normalize(el.textContent), rect: el.getBoundingClientRect(), className: String(el.className || '') }))
      .filter((item) => item.text.includes(${JSON.stringify(text)}) && item.rect.width > 0 && item.rect.height > 0);
    const target = candidates.find((item) => item.className.includes('sidebar-item')) || candidates[0];
    if (!target) return { ok: false, reason: 'not-found', text: ${JSON.stringify(text)} };
    target.el.click();
    return { ok: true, text: target.text, className: target.className };
  })()`
}

function clickDropdownOptionExpression(text) {
  return `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const options = [...document.querySelectorAll('.n-dropdown-option-body')]
      .map((el) => ({ el, text: normalize(el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0);
    const target = options.find((item) => item.text === ${JSON.stringify(text)})
      || options.find((item) => item.text.includes(${JSON.stringify(text)}));
    if (!target) return { ok: false, reason: 'dropdown-option-not-found', text: ${JSON.stringify(text)}, options: options.map((item) => item.text) };
    target.el.click();
    return { ok: true, text: target.text };
  })()`
}

function clickDialogButtonExpression(text) {
  return `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const buttons = [...document.querySelectorAll('button')]
      .map((el) => ({ el, text: normalize(el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0);
    const target = buttons.find((item) => item.text === ${JSON.stringify(text)})
      || buttons.find((item) => item.text.includes(${JSON.stringify(text)}));
    if (!target) return { ok: false, reason: 'dialog-button-not-found', text: ${JSON.stringify(text)}, buttons: buttons.map((item) => item.text).filter(Boolean).slice(-20) };
    target.el.click();
    return { ok: true, text: target.text };
  })()`
}

function clickFirstInventoryFolderExpression() {
  return `(() => {
    const folders = [...document.querySelectorAll('.inventory-folder-node-label')];
    const target = folders.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!target) return { ok: false, reason: 'folder-node-not-found' };
    target.click();
    return { ok: true, text: (target.textContent || '').replace(/\\s+/g, ' ').trim() };
  })()`
}

function sidebarSearchExpression(value) {
  return `(() => {
    const inputs = [...document.querySelectorAll('input')];
    const input = inputs.find((el) => {
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      return placeholder.includes('pasta') || placeholder.includes('folder') || placeholder.includes('grupo') || placeholder.includes('corporate');
    });
    if (!input) return { ok: false, reason: 'sidebar-search-not-found' };
    input.focus();
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: input.value, placeholder: input.getAttribute('placeholder') };
  })()`
}

function contextMenuFirstFolderExpression() {
  return `(() => {
    const folders = [...document.querySelectorAll('.inventory-folder-node-label')];
    const target = folders.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!target) return { ok: false, reason: 'folder-node-not-found' };
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(24, rect.width / 2),
      clientY: rect.top + rect.height / 2,
      button: 2,
    }));
    return { ok: true, text: (target.textContent || '').replace(/\\s+/g, ' ').trim() };
  })()`
}

function contextMenuCorporateHeaderExpression() {
  return `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const rows = [...document.querySelectorAll('.sidebar-panel-row, .sidebar-panel-toggle, button')];
    const target = rows.find((el) => {
      const text = normalize(el.textContent).toLowerCase();
      const rect = el.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && (text.includes('corporativas') || text.includes('corporate'));
    });
    if (!target) return { ok: false, reason: 'corporate-header-not-found' };
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(28, rect.width / 2),
      clientY: rect.top + rect.height / 2,
      button: 2,
    }));
    return { ok: true, text: normalize(target.textContent) };
  })()`
}

function validateCorporateHeaderContextExpression() {
  return `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const options = [...document.querySelectorAll('.n-dropdown-option-body')]
      .map((el) => normalize(el.textContent))
      .filter(Boolean);
    const hasRootCreate = options.some((text) => (
      text.includes('Criar pasta corporativa')
      || text.includes('Create corporate folder')
      || text.includes('Criar pasta')
      || text.includes('Create folder')
    ));
    const folderOnlyPatterns = [
      'Renomear',
      'Rename',
      'Criar Host',
      'Create Host',
      'Permissoes',
      'Permissões',
      'Manage permissions',
      'Excluir',
      'Delete',
    ];
    const hasFolderMenuLeak = options.some((text) => folderOnlyPatterns.some((pattern) => text.includes(pattern)));
    return {
      ok: options.length > 0 && hasRootCreate && !hasFolderMenuLeak,
      options,
      hasRootCreate,
      hasFolderMenuLeak,
    };
  })()`
}

function clickOutsideSidebarContextExpression() {
  return `(async () => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const sidebar = document.querySelector('.inventory-sidebar-tree')
      ?.closest('aside, nav, [class*="sidebar"], [class*="Sidebar"], .n-layout-sider');
    const rect = sidebar ? sidebar.getBoundingClientRect() : null;
    const x = rect
      ? Math.min(window.innerWidth - 20, Math.max(20, rect.right + 40))
      : Math.min(window.innerWidth - 20, Math.max(20, Math.round(window.innerWidth * 0.65)));
    const y = rect
      ? Math.min(window.innerHeight - 20, Math.max(20, rect.top + 40))
      : Math.min(window.innerHeight - 20, 80);
    const target = document.elementFromPoint(x, y) || document.body;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    const options = [...document.querySelectorAll('.n-dropdown-option-body')]
      .map((el) => {
        const optionRect = el.getBoundingClientRect();
        return optionRect.width > 0 && optionRect.height > 0 ? normalize(el.textContent) : '';
      })
      .filter(Boolean);
    const overlays = [...document.querySelectorAll('.n-dropdown-menu, .n-popover, .n-modal, .n-drawer, .n-dialog')]
      .map((el) => {
        const overlayRect = el.getBoundingClientRect();
        return { text: normalize(el.textContent).slice(0, 160), visible: overlayRect.width > 0 && overlayRect.height > 0 };
      })
      .filter((item) => item.visible);
    return {
      ok: options.length === 0,
      clickedAt: { x, y },
      target: normalize(target.textContent).slice(0, 120),
      options,
      overlays,
    };
  })()`
}

function contextMenuFirstHostExpression() {
  return `(() => {
    const hosts = [...document.querySelectorAll('.inventory-host-node-label')];
    const target = hosts.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!target) return { ok: false, reason: 'host-node-not-found' };
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(24, rect.width / 2),
      clientY: rect.top + rect.height / 2,
      button: 2,
    }));
    return { ok: true, text: (target.textContent || '').replace(/\\s+/g, ' ').trim() };
  })()`
}

function dragReadinessExpression() {
  return `(() => {
    const host = [...document.querySelectorAll('.inventory-host-node-label')]
      .find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const folder = [...document.querySelectorAll('.inventory-folder-node-label')]
      .find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    return {
      ok: !!host && !!folder,
      hostText: host ? (host.textContent || '').replace(/\\s+/g, ' ').trim() : null,
      hostDraggable: host ? host.getAttribute('draggable') : null,
      folderText: folder ? (folder.textContent || '').replace(/\\s+/g, ' ').trim() : null,
    };
  })()`
}

function invalidDropReadinessExpression() {
  return `(() => {
    const host = [...document.querySelectorAll('.inventory-host-node-label')]
      .find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const invalidTarget = document.querySelector('.inventory-host-node-label') || document.body;
    return {
      ok: !!host && !!invalidTarget,
      sourceText: host ? (host.textContent || '').replace(/\\s+/g, ' ').trim() : null,
      targetText: invalidTarget ? (invalidTarget.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : null,
      note: 'Readiness only; mutating invalid-drop is intentionally not executed.',
    };
  })()`
}

async function keyboardNavigationCheck(cdp, label) {
  await closeOverlays(cdp)
  const steps = []
  for (let index = 0; index < 8; index += 1) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await new Promise((resolve) => setTimeout(resolve, 80))
    steps.push(await evaluate(cdp, `(() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const el = document.activeElement;
      if (!el || el === document.body) return { focused: false };
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        focused: true,
        text: normalize(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 120),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        className: String(el.className || '').slice(0, 140),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        hasVisibleFocusStyle: style.outlineStyle !== 'none'
          || style.outlineWidth !== '0px'
          || style.boxShadow !== 'none',
      };
    })()`))
  }
  const usefulFocus = steps.some((step) => {
    const text = `${step.text || ''} ${step.className || ''} ${step.role || ''}`.toLowerCase()
    return step.focused && (text.includes('sidebar') || text.includes('tree') || text.includes('host') || text.includes('pasta') || text.includes('folder'))
  })
  return {
    label,
    ok: usefulFocus,
    steps,
  }
}

async function collectResponsiveUx(cdp) {
  if (!SIDEBAR_UX_AUDIT || SIDEBAR_UX_VIEWPORTS.length === 0) return []
  const results = []
  for (const viewport of SIDEBAR_UX_VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 700,
    })
    await cdp.send('Page.navigate', { url: `${FRONTEND}/hosts?sidebar_ux_viewport=${viewport.width}x${viewport.height}&t=${Date.now()}` })
    await waitFor(cdp, `!!document.body && !location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
    await waitFor(cdp, `document.querySelector('.inventory-sidebar-tree') || document.body.innerText.includes('Corporate') || document.body.innerText.includes('Corporativo')`, 15000)
    await new Promise((resolve) => setTimeout(resolve, 900))
    results.push(await uxSnapshot(cdp, `responsive-${viewport.width}x${viewport.height}-initial`))
    await evaluate(cdp, contextMenuFirstFolderExpression())
    await new Promise((resolve) => setTimeout(resolve, 350))
    results.push(await uxSnapshot(cdp, `responsive-${viewport.width}x${viewport.height}-folder-menu`))
    await closeOverlays(cdp)
  }
  const first = SIDEBAR_UX_VIEWPORTS[0] || { width: 1440, height: 1000 }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: first.width,
    height: first.height,
    deviceScaleFactor: 1,
    mobile: first.width < 700,
  })
  return results
}

async function optionalDragMove(cdp) {
  if (!SIDEBAR_MUTATE) {
    return { skipped: true, reason: 'Set SIDEBAR_MUTATE=1 to execute mutating drag/drop checks.' }
  }
  if (!SIDEBAR_DRAG_FROM_HOST_ID) {
    return { skipped: true, reason: 'Set SIDEBAR_DRAG_FROM_HOST_ID.' }
  }
  const setup = await evaluate(cdp, `(async () => {
    const hostId = ${JSON.stringify(SIDEBAR_DRAG_FROM_HOST_ID)};
    const createFolders = ${JSON.stringify(SIDEBAR_CREATE_TEST_FOLDERS)};
    const requestedFolderText = ${JSON.stringify(SIDEBAR_DRAG_TO_FOLDER_TEXT)};
    const token = localStorage.getItem('na_access_token');
    const headers = {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    };
    const hostNodeResponse = await fetch('/api/v1/inventory/hosts/' + hostId + '/node', { headers });
    const hostNode = hostNodeResponse.ok ? await hostNodeResponse.json() : null;
    const nodesResponse = await fetch('/api/v1/inventory', { headers });
    const nodes = nodesResponse.ok ? await nodesResponse.json() : [];
    let folderText = requestedFolderText;
    let created = null;
    if (createFolders) {
      const root = nodes.find((node) => node.type === 'ROOT');
      if (!root) return { ok: false, reason: 'root-not-found', hostNode, hostNodeStatus: hostNodeResponse.status, nodesStatus: nodesResponse.status, nodesSample: Array.isArray(nodes) ? nodes.slice(0, 3) : nodes };
      const suffix = String(Date.now()).slice(-6);
      const parentName = 'CDP ACL Move ' + suffix;
      const childName = 'CDP ACL Destino ' + suffix;
      const parentResponse = await fetch('/api/v1/inventory/folders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ parentId: root.id, name: parentName }),
      });
      const parent = parentResponse.ok ? await parentResponse.json() : null;
      if (!parent) return { ok: false, reason: 'parent-create-failed', status: parentResponse.status, hostNode };
      const childResponse = await fetch('/api/v1/inventory/folders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ parentId: parent.id, name: childName }),
      });
      const child = childResponse.ok ? await childResponse.json() : null;
      if (!child) return { ok: false, reason: 'child-create-failed', status: childResponse.status, hostNode, parent };
      folderText = childName;
      created = { parent, child };
    }
    window.__sidebarMoveHostName = hostNode?.name || null;
    window.__sidebarMoveFolderText = folderText;
    return { ok: true, hostNode, folderText, created };
  })()`)
  if (!setup.ok) return setup
  SIDEBAR_DRAG_TO_FOLDER_TEXT = setup.folderText
  if (setup.created) {
    await cdp.send('Page.navigate', { url: `${FRONTEND}/hosts?sidebar_cdp_mutate=${Date.now()}` })
    await waitFor(cdp, `document.querySelector('.inventory-sidebar-tree')`, 15000)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await evaluate(cdp, `(() => {
      window.__sidebarMoveHostName = ${JSON.stringify(setup.hostNode?.name || null)};
      window.__sidebarMoveFolderText = ${JSON.stringify(setup.folderText)};
      return true;
    })()`)
  }
  if (!SIDEBAR_DRAG_TO_FOLDER_TEXT) {
    return { skipped: true, reason: 'Set SIDEBAR_DRAG_TO_FOLDER_TEXT or SIDEBAR_CREATE_TEST_FOLDERS=1.', setup }
  }

  const coords = await evaluate(cdp, `(() => {
    const hostId = ${JSON.stringify(String(SIDEBAR_DRAG_FROM_HOST_ID))};
    const folderText = window.__sidebarMoveFolderText || ${JSON.stringify(SIDEBAR_DRAG_TO_FOLDER_TEXT)};
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const host = [...document.querySelectorAll('.inventory-host-node-label')]
      .find((el) => normalize(el.textContent).includes(hostId))
      || [...document.querySelectorAll('.inventory-host-node-label')]
        .find((el) => {
          const text = normalize(el.textContent);
          return window.__sidebarMoveHostName && text.includes(window.__sidebarMoveHostName);
        });
    const folder = [...document.querySelectorAll('.inventory-folder-node-label')]
      .find((el) => normalize(el.textContent).includes(folderText));
    if (!host || !folder) return { ok: false, reason: 'host-or-folder-not-found', hostFound: !!host, folderFound: !!folder };
    const h = host.getBoundingClientRect();
    const f = folder.getBoundingClientRect();
    return {
      ok: true,
      hostText: normalize(host.textContent),
      folderText: normalize(folder.textContent),
      from: { x: h.left + Math.min(20, h.width / 2), y: h.top + h.height / 2 },
      to: { x: f.left + Math.min(20, f.width / 2), y: f.top + f.height / 2 },
    };
  })()`)
  if (!coords.ok) return coords

  const startEventIndex = cdp.events.length
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.from.x, y: coords.from.y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.from.x, y: coords.from.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.to.x, y: coords.to.y, button: 'left' })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.to.x, y: coords.to.y, button: 'left', clickCount: 1 })
  await new Promise((resolve) => setTimeout(resolve, POST_ACTION_WAIT_MS))
  return {
    setup,
    ...coords,
    network: summarizeNetwork(cdp.events.slice(startEventIndex)),
    after: await snapshot(cdp, 'optional-drag-move:after'),
  }
}

async function run(cdp) {
  cdp.events.length = 0
  const navStart = Date.now()
  await cdp.send('Page.navigate', { url: `${FRONTEND}/hosts?sidebar_cdp=${Date.now()}` })
  await waitFor(cdp, `!!document.body && !location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await evaluate(cdp, `(async () => {
    try {
      if (navigator.serviceWorker?.getRegistrations) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if (window.caches?.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch {}
    return true;
  })()`)
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(cdp, `!!document.body && !location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await waitFor(cdp, `document.querySelector('.inventory-sidebar-tree') || document.body.innerText.includes('Corporate') || document.body.innerText.includes('Corporativo')`, 15000)
  await evaluate(cdp, `(() => {
    if (!window.__sidebarPerfMutationObserver && document.body) {
      window.__sidebarPerfMutationObserver = new MutationObserver((mutations) => {
        window.__sidebarPerf = window.__sidebarPerf || {};
        window.__sidebarPerf.mutationCount = (window.__sidebarPerf.mutationCount || 0) + mutations.length;
      });
      window.__sidebarPerfMutationObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: false,
      });
    }
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const scenarios = []
  const uxSnapshots = []
  const keyboardChecks = []

  scenarios.push({
    label: 'initial-load',
    navMs: Date.now() - navStart,
    snapshot: await snapshot(cdp, 'initial-load'),
    network: summarizeNetwork(cdp.events),
  })
  if (SIDEBAR_UX_AUDIT) {
    uxSnapshots.push(await uxSnapshot(cdp, 'initial-load'))
    keyboardChecks.push(await keyboardNavigationCheck(cdp, 'initial-load'))
  }

  const body = scenarios[0].snapshot.bodyStart
  const allLabel = body.includes('Todos os hosts') ? 'Todos os hosts' : 'All hosts'
  const recentLabel = body.includes('Recentes') ? 'Recentes' : 'Recent'

  scenarios.push(await measure(cdp, 'navigate-all', clickTextExpression(allLabel)))
  scenarios.push(await measure(cdp, 'navigate-recent', clickTextExpression(recentLabel)))
  scenarios.push(await measure(cdp, 'navigate-first-corporate-folder', clickFirstInventoryFolderExpression()))

  if (SIDEBAR_SEARCH) {
    scenarios.push(await measure(cdp, 'sidebar-search', sidebarSearchExpression(SIDEBAR_SEARCH)))
    scenarios.push(await measure(cdp, 'sidebar-search-clear', sidebarSearchExpression('')))
  }

  scenarios.push(await measure(cdp, 'corporate-header-context-menu', contextMenuCorporateHeaderExpression()))
  scenarios.push(await measure(cdp, 'corporate-header-context-menu-state', validateCorporateHeaderContextExpression()))
  scenarios.push(await measure(cdp, 'corporate-header-context-menu-clickoutside', clickOutsideSidebarContextExpression()))
  await closeOverlays(cdp)

  scenarios.push(await measure(cdp, 'folder-context-menu', contextMenuFirstFolderExpression()))
  if (SIDEBAR_UX_AUDIT) {
    uxSnapshots.push(await uxSnapshot(cdp, 'folder-context-menu-open'))
  }
  if (SIDEBAR_SCENARIO_SET === 'extended') {
    scenarios.push(await measure(cdp, 'folder-context-menu-escape-close', pressEscapeExpression()))
    scenarios.push(await measure(cdp, 'folder-context-menu-escape-state', overlayStateExpression()))
    scenarios.push(await measure(cdp, 'folder-context-menu-reopen-for-delete', contextMenuFirstFolderExpression()))
    scenarios.push(await measure(cdp, 'folder-menu-delete-open', clickDropdownOptionExpression(body.includes('Excluir pasta') ? 'Excluir pasta' : 'Delete folder')))
    scenarios.push(await measure(cdp, 'folder-delete-cancel', clickDialogButtonExpression(body.includes('Cancelar') ? 'Cancelar' : 'Cancel')))
    await closeOverlays(cdp)
  }

  scenarios.push(await measure(cdp, 'folder-context-menu-rename', contextMenuFirstFolderExpression()))
  scenarios.push(await measure(cdp, 'folder-menu-rename-open', clickDropdownOptionExpression(body.includes('Renomear') ? 'Renomear' : 'Rename')))
  await closeOverlays(cdp)

  scenarios.push(await measure(cdp, 'folder-context-menu-create-folder', contextMenuFirstFolderExpression()))
  scenarios.push(await measure(cdp, 'folder-menu-create-folder-open', clickDropdownOptionExpression(body.includes('Criar') ? 'Criar' : 'Create')))
  await closeOverlays(cdp)

  scenarios.push(await measure(cdp, 'folder-context-menu-create-host', contextMenuFirstFolderExpression()))
  scenarios.push(await measure(cdp, 'folder-menu-create-host-open', clickDropdownOptionExpression(body.includes('Criar Host') ? 'Criar Host' : 'Create Host')))
  await closeOverlays(cdp)

  scenarios.push(await measure(cdp, 'folder-context-menu-permissions', contextMenuFirstFolderExpression()))
  scenarios.push(await measure(cdp, 'folder-menu-permissions-open', clickDropdownOptionExpression(body.includes('Gerenciar permissões') ? 'Gerenciar permissões' : 'Manage permissions')))
  await closeOverlays(cdp)

  scenarios.push(await measure(cdp, 'host-context-menu', contextMenuFirstHostExpression()))
  if (SIDEBAR_UX_AUDIT) {
    uxSnapshots.push(await uxSnapshot(cdp, 'host-context-menu-open'))
  }
  if (SIDEBAR_SCENARIO_SET === 'extended') {
    scenarios.push(await measure(cdp, 'host-context-menu-escape-close', pressEscapeExpression()))
    scenarios.push(await measure(cdp, 'host-context-menu-escape-state', overlayStateExpression()))

    scenarios.push(await measure(cdp, 'host-context-menu-reopen-for-acl', contextMenuFirstHostExpression()))
    scenarios.push(await measure(cdp, 'host-menu-corporate-acl-open', clickDropdownOptionExpression(body.includes('ACL corporativa') ? 'ACL corporativa' : 'Corporate ACL')))
    await closeOverlays(cdp)

    scenarios.push(await measure(cdp, 'host-context-menu-reopen-for-remove-acl', contextMenuFirstHostExpression()))
    scenarios.push(await measure(cdp, 'host-menu-remove-acl-open', clickDropdownOptionExpression(body.includes('Remover da pasta ACL') ? 'Remover da pasta ACL' : 'Remove from ACL folder')))
    scenarios.push(await measure(cdp, 'host-remove-acl-cancel', clickDialogButtonExpression(body.includes('Cancelar') ? 'Cancelar' : 'Cancel')))
    await closeOverlays(cdp)

    scenarios.push(await measure(cdp, 'host-context-menu-reopen-for-delete', contextMenuFirstHostExpression()))
    scenarios.push(await measure(cdp, 'host-menu-delete-open', clickDropdownOptionExpression(body.includes('Excluir host') ? 'Excluir host' : 'Delete host')))
    scenarios.push(await measure(cdp, 'host-delete-cancel', clickDialogButtonExpression(body.includes('Cancelar') ? 'Cancelar' : 'Cancel')))
    await closeOverlays(cdp)
  }
  await closeOverlays(cdp)

  scenarios.push(await measure(cdp, 'drag-readiness', dragReadinessExpression()))
  if (SIDEBAR_SCENARIO_SET === 'extended') {
    scenarios.push(await measure(cdp, 'invalid-drop-readiness', invalidDropReadinessExpression()))
  }
  if (SIDEBAR_UX_AUDIT) {
    uxSnapshots.push(...await collectResponsiveUx(cdp))
  }
  const optionalMutation = await optionalDragMove(cdp)
  const staticChecks = runStaticInventoryTreeKeyChecks()
  const uxFindings = SIDEBAR_UX_AUDIT ? buildUxFindings(uxSnapshots, keyboardChecks) : []
  const aclSidebarFindings = buildAclSidebarFindings(staticChecks, scenarios)

  const browserErrors = await evaluate(cdp, `window.__sidebarPerfErrors || []`)
  return {
    frontend: FRONTEND,
    cdpBase: CDP_BASE,
    tenantId: TENANT_ID,
    scenarioSet: SIDEBAR_SCENARIO_SET,
    uxAuditEnabled: SIDEBAR_UX_AUDIT,
    mutateEnabled: SIDEBAR_MUTATE,
    scenarios,
    uxSnapshots,
    keyboardChecks,
    uxFindings,
    aclSidebarFindings,
    staticChecks,
    optionalMutation,
    browserErrors,
    consoleErrors: cdp.events
      .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
      .slice(-20),
    summary: scenarios.map((scenario) => ({
      label: scenario.label,
      observationMs: scenario.observationMs ?? scenario.navMs ?? null,
      actionOk: scenario.action?.ok ?? null,
      longTaskTotalMs: scenario.deltas?.longTaskTotalMs ?? scenario.snapshot?.longTaskTotalMs ?? null,
      layoutShiftTotal: scenario.deltas?.layoutShiftTotal ?? scenario.snapshot?.layoutShiftTotal ?? null,
      nodeDelta: scenario.deltas?.nodeCount ?? null,
      apiCalls: scenario.network?.calls?.length ?? 0,
      failedApiCalls: scenario.network?.failures?.length ?? 0,
    })),
  }
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
  }, readJwtSecret())

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__sidebarPerfErrors = [];
      window.__sidebarPerf = { longTasks: [], layoutShifts: [], mutationCount: 0 };
      try {
        new PerformanceObserver((list) => {
          window.__sidebarPerf.longTasks.push(...list.getEntries().map((entry) => ({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          })).slice(-100));
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      try {
        new PerformanceObserver((list) => {
          window.__sidebarPerf.layoutShifts.push(...list.getEntries()
            .filter((entry) => !entry.hadRecentInput)
            .map((entry) => ({ startTime: entry.startTime, value: entry.value })).slice(-100));
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      window.addEventListener('error', (event) => {
        window.__sidebarPerfErrors.push({ type: 'error', message: event.message, source: event.filename, line: event.lineno });
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__sidebarPerfErrors.push({ type: 'unhandledrejection', reason: String(event.reason) });
      });
      localStorage.setItem('na_access_token', ${JSON.stringify(token)});
      localStorage.setItem('na_refresh_token', 'cdp-dev-refresh-placeholder');
      localStorage.setItem('na_hosts_display_mode', 'list');
      localStorage.setItem('na_hosts_default_view', 'all');
      localStorage.setItem('na_corporate_folders_panel_expanded', 'true');
    `,
  })

  const report = await run(cdp)
  const output = JSON.stringify(report, null, 2)
  if (process.env.REPORT_PATH) {
    fs.mkdirSync(path.dirname(process.env.REPORT_PATH), { recursive: true })
    fs.writeFileSync(process.env.REPORT_PATH, `${output}\n`)
  }
  console.log(output)
  cdp.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
