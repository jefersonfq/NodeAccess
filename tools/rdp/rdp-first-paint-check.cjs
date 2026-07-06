#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const WebSocket = require('ws')

const rootDir = path.resolve(__dirname, '../..')

const cliEnv = {}
for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith('--') || arg === '--help') continue
  const [rawKey, ...rawValue] = arg.slice(2).split('=')
  if (!rawKey || rawValue.length === 0) continue
  const envKey = rawKey.replace(/-/g, '_').toUpperCase()
  cliEnv[envKey] = rawValue.join('=')
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

const fileEnv = Object.assign(
  {},
  readEnvFile(path.join(rootDir, '.env')),
  readEnvFile(path.join(rootDir, '.env.local')),
  readEnvFile(path.join(rootDir, 'apps/backend/.env')),
  readEnvFile(path.join(rootDir, 'apps/backend/.env.local')),
)

function env(name, fallback) {
  return cliEnv[name] || process.env[name] || fileEnv[name] || fallback
}

function numberEnv(name, fallback) {
  const value = Number(env(name, fallback))
  return Number.isFinite(value) ? value : fallback
}

const config = {
  apiBase: env('API_BASE', 'http://localhost:3100/api/v1'),
  cdpBase: env('CDP_BASE', 'http://127.0.0.1:9223'),
  hostId: env('HOST_ID', '829'),
  frontendBase: env('FRONTEND_BASE', 'http://localhost:5174'),
  frontendUrl: env('FRONTEND_URL', null),
  outputDir: path.resolve(rootDir, env('OUTPUT_DIR', 'tools/rdp/reports')),
  timeoutMs: numberEnv('TIMEOUT_MS', 30_000),
  sampleIntervalMs: numberEnv('SAMPLE_INTERVAL_MS', 250),
  viewportWidth: numberEnv('VIEWPORT_WIDTH', 1280),
  viewportHeight: numberEnv('VIEWPORT_HEIGHT', 720),
  deviceScaleFactor: numberEnv('DEVICE_SCALE_FACTOR', 1),
  usefulBrightMin: numberEnv('USEFUL_BRIGHT_MIN', 20),
  usefulUniqueMin: numberEnv('USEFUL_UNIQUE_MIN', 4),
  minImageBytes: numberEnv('MIN_IMAGE_BYTES', 1000),
  minImageArea: numberEnv('MIN_IMAGE_AREA', 1024),
  manualClickMs: env('MANUAL_CLICK_MS', '') === '' ? null : numberEnv('MANUAL_CLICK_MS', null),
  clickXRatio: numberEnv('CLICK_X_RATIO', 0.5),
  clickYRatio: numberEnv('CLICK_Y_RATIO', 0.4),
}

config.frontendUrl =
  config.frontendUrl ||
  `${config.frontendBase.replace(/\/$/, '')}/graphical/${config.hostId}?rdpDebug=1`

function usage() {
  console.log(`
RDP first-paint check

Required:
  A Chromium/Chrome instance with CDP enabled on ${config.cdpBase}
  The frontend/backend stack running with a reachable graphical session.

Auth options:
  RDP_TEST_ACCESS_TOKEN=<jwt>                         Uses an existing authenticated token.
  JWT_SECRET=<secret>                                 Creates a local dev JWT for the seeded admin.
  LOGIN_EMAIL/LOGIN_PASSWORD[/LOGIN_TOTP_CODE]        Falls back to API login when possible.

Main options:
  FRONTEND_URL=http://localhost:5174/graphical/829?rdpDebug=1
  MANUAL_CLICK_MS=5000                                Dispatches a synthetic click after 5s.
  CLICK_X_RATIO=0.5 CLICK_Y_RATIO=0.4                 Canvas click point.
  TIMEOUT_MS=30000 OUTPUT_DIR=tools/rdp/reports

CLI equivalents:
  --frontend-url=http://localhost:5174/graphical/829?rdpDebug=1
  --manual-click-ms=5000 --click-x-ratio=0.5 --click-y-ratio=0.4
  --timeout-ms=45000 --device-scale-factor=1.5
  --min-image-bytes=1000 --min-image-area=1024
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage()
  process.exit(0)
}

function requestJson(url, options = {}) {
  const parsed = new URL(url)
  const client = parsed.protocol === 'https:' ? https : http
  const body = options.body ? JSON.stringify(options.body) : null
  return new Promise((resolve, reject) => {
    const req = client.request(
      parsed,
      {
        method: options.method || 'GET',
        headers: Object.assign(
          body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
          options.headers || {},
        ),
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${options.method || 'GET'} ${url} returned ${res.statusCode}: ${data.slice(0, 300)}`))
            return
          }
          try {
            resolve(data ? JSON.parse(data) : null)
          } catch (error) {
            reject(new Error(`Invalid JSON from ${url}: ${error.message}`))
          }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function signJwt(payload, secret, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify({ iat: now, exp: now + ttlSeconds, ...payload }))
  const data = `${header}.${body}`
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${data}.${signature}`
}

async function getToken() {
  const existing = env('RDP_TEST_ACCESS_TOKEN', '')
  if (existing) return { token: existing, source: 'RDP_TEST_ACCESS_TOKEN' }

  const secret = env('JWT_SECRET', '')
  if (secret) {
    return {
      token: signJwt(
        {
          sub: String(env('JWT_USER_ID', '1')),
          email: env('JWT_EMAIL', 'admin@nodeaccess.local'),
          role: env('JWT_ROLE', 'admin'),
          isPlatformAdmin: env('JWT_PLATFORM_ADMIN', 'false') === 'true',
          tenantId: Number(env('JWT_TENANT_ID', '1')),
          canManageHosts: env('JWT_CAN_MANAGE_HOSTS', 'true') !== 'false',
          forcePasswordChange: false,
          stage: 'authenticated',
        },
        secret,
        numberEnv('JWT_TTL_SECONDS', 3600),
      ),
      source: 'JWT_SECRET',
    }
  }

  const email = env('LOGIN_EMAIL', '')
  const password = env('LOGIN_PASSWORD', '')
  if (!email || !password) {
    throw new Error('Missing auth. Set RDP_TEST_ACCESS_TOKEN, JWT_SECRET, or LOGIN_EMAIL/LOGIN_PASSWORD.')
  }

  const login = await requestJson(`${config.apiBase.replace(/\/$/, '')}/auth/login`, {
    method: 'POST',
    body: {
      email,
      password,
      tenantSlug: env('LOGIN_TENANT_SLUG', 'nodeaccess'),
    },
  })
  if (login.accessToken) return { token: login.accessToken, source: 'LOGIN_PASSWORD' }

  const totp = env('LOGIN_TOTP_CODE', '')
  if (login.tempToken && totp) {
    const verified = await requestJson(`${config.apiBase.replace(/\/$/, '')}/auth/verify-totp`, {
      method: 'POST',
      body: { tempToken: login.tempToken, code: totp },
    })
    if (verified.accessToken) return { token: verified.accessToken, source: 'LOGIN_TOTP_CODE' }
  }

  throw new Error('Password login reached MFA. Set LOGIN_TOTP_CODE or use JWT_SECRET/RDP_TEST_ACCESS_TOKEN.')
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ''}`))
        else resolve(message.result || {})
        return
      }
      if (message.method) this.events.push(message)
    })
  }

  waitOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 10_000)
    })
  }

  close() {
    this.ws.close()
  }
}

async function openPageTarget() {
  try {
    return await requestJson(`${config.cdpBase.replace(/\/$/, '')}/json/new?about:blank`, { method: 'PUT' })
  } catch (_error) {
    const targets = await requestJson(`${config.cdpBase.replace(/\/$/, '')}/json`)
    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    if (!page) throw new Error('No CDP page target found. Open Chrome with --remote-debugging-port=9223.')
    return page
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result ? result.result.value : undefined
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function summarizeEvents(events) {
  const interesting = [
    'gateway-connected',
    'send-size',
    'mouse-wakeup-start',
    'mouse-wakeup-click',
    'rdp-activation-wakeup',
    'render-command',
    'image-draw-complete',
    'render-complete',
  ]
  const counts = {}
  const first = {}
  const images = {
    maxBytes: 0,
    maxArea: 0,
    count: 0,
  }
  for (const event of events) {
    const key = event.event
    counts[key] = (counts[key] || 0) + 1
    if (interesting.includes(key) && first[key] == null) first[key] = Math.round(event.at)
    if (key === 'image-draw-complete') {
      images.count += 1
      const bytes = Number(event.payload?.command?.bytes || 0)
      const width = Number(event.payload?.image?.width || 0)
      const height = Number(event.payload?.image?.height || 0)
      images.maxBytes = Math.max(images.maxBytes, bytes)
      images.maxArea = Math.max(images.maxArea, width * height)
    }
  }
  return { counts, first, images }
}

function getRemoteImageStats(events) {
  return events.reduce(
    (acc, event) => {
      if (event.event !== 'image-draw-complete') return acc
      const bytes = Number(event.payload?.command?.bytes || 0)
      const width = Number(event.payload?.image?.width || 0)
      const height = Number(event.payload?.image?.height || 0)
      return {
        count: acc.count + 1,
        maxBytes: Math.max(acc.maxBytes, bytes),
        maxArea: Math.max(acc.maxArea, width * height),
      }
    },
    { count: 0, maxBytes: 0, maxArea: 0 },
  )
}

async function main() {
  fs.mkdirSync(config.outputDir, { recursive: true })
  const started = Date.now()
  const auth = await getToken()
  const target = await openPageTarget()
  if (!target.webSocketDebuggerUrl) throw new Error('CDP target did not include webSocketDebuggerUrl.')

  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.waitOpen()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: config.viewportWidth,
    height: config.viewportHeight,
    deviceScaleFactor: config.deviceScaleFactor,
    mobile: false,
  })

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (() => {
        localStorage.setItem('na_access_token', ${JSON.stringify(auth.token)});
        localStorage.setItem('na_refresh_token', 'rdp-test-refresh-placeholder');
        localStorage.setItem('na_rdp_debug', '1');
        window.__rdpDebugEvents = [];
        const originalDebug = console.debug.bind(console);
        console.debug = (...args) => {
          try {
            if (typeof args[0] === 'string' && args[0].startsWith('[graphical-rdp] ')) {
              window.__rdpDebugEvents.push({
                at: performance.now(),
                event: args[0].slice('[graphical-rdp] '.length),
                payload: args[1] || null,
              });
            }
          } catch (_) {}
          originalDebug(...args);
        };
      })();
    `,
  })

  await cdp.send('Page.navigate', { url: config.frontendUrl })

  const samples = []
  let usefulAt = null
  let manualClickAt = null
  let manualClickSent = false
  let finalEvents = []

  const sampleExpression = `(() => {
    const canvas = document.querySelector('canvas');
    const sample = { width: 0, height: 0, cssWidth: 0, cssHeight: 0, pixels: 0, bright: 0, unique: 0 };
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      sample.width = canvas.width;
      sample.height = canvas.height;
      sample.cssWidth = Math.round(rect.width);
      sample.cssHeight = Math.round(rect.height);
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const stepX = Math.max(1, Math.floor(canvas.width / 32));
        const stepY = Math.max(1, Math.floor(canvas.height / 24));
        const colors = new Set();
        for (let y = 0; y < canvas.height; y += stepY) {
          for (let x = 0; x < canvas.width; x += stepX) {
            const data = ctx.getImageData(x, y, 1, 1).data;
            sample.pixels += 1;
            if (data[0] + data[1] + data[2] > 30) sample.bright += 1;
            colors.add(data[0] + ',' + data[1] + ',' + data[2] + ',' + data[3]);
          }
        }
        sample.unique = colors.size;
      } catch (error) {
        sample.error = error.message;
      }
    }
    return {
      at: performance.now(),
      href: location.href,
      readyState: document.readyState,
      title: document.title,
      devicePixelRatio: window.devicePixelRatio,
      text: document.body ? document.body.innerText.slice(0, 800) : '',
      canvas: sample,
      events: window.__rdpDebugEvents || [],
    };
  })()`

  const clickPointExpression = `(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width * ${JSON.stringify(config.clickXRatio)}),
      y: Math.round(rect.top + rect.height * ${JSON.stringify(config.clickYRatio)}),
    };
  })()`

  while (Date.now() - started < config.timeoutMs) {
    const elapsed = Date.now() - started
    if (config.manualClickMs != null && !manualClickSent && elapsed >= config.manualClickMs) {
      const point = await evaluate(cdp, clickPointExpression)
      if (point) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' })
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        manualClickAt = elapsed
      }
      manualClickSent = true
    }

    const sample = await evaluate(cdp, sampleExpression)
    finalEvents = sample.events || []
    const hasRemoteRender = finalEvents.some((event) =>
      event.event === 'render-command' ||
      event.event === 'image-draw-complete' ||
      event.event === 'render-complete'
    )
    const imageStats = getRemoteImageStats(finalEvents)
    const hasUsefulRemoteImage =
      imageStats.maxBytes >= config.minImageBytes ||
      imageStats.maxArea >= config.minImageArea
    const normalized = {
      elapsedMs: elapsed,
      at: Math.round(sample.at || 0),
      readyState: sample.readyState,
      href: sample.href,
      devicePixelRatio: sample.devicePixelRatio,
      hasRemoteRender,
      hasUsefulRemoteImage,
      imageStats,
      canvas: sample.canvas,
      eventCount: finalEvents.length,
      lastEvents: finalEvents.slice(-5),
    }
    samples.push(normalized)

    const canvas = sample.canvas || {}
    if (
      usefulAt == null &&
      hasRemoteRender &&
      hasUsefulRemoteImage &&
      canvas.bright >= config.usefulBrightMin &&
      canvas.unique >= config.usefulUniqueMin
    ) {
      usefulAt = elapsed
      break
    }

    await new Promise((resolve) => setTimeout(resolve, config.sampleIntervalMs))
  }

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const baseName = `rdp-first-paint-${nowStamp()}`
  const screenshotPath = path.join(config.outputDir, `${baseName}.png`)
  const reportPath = path.join(config.outputDir, `${baseName}.json`)
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  const summary = summarizeEvents(finalEvents)
  const report = {
    createdAt: new Date().toISOString(),
    config: {
      ...config,
      tokenSource: auth.source,
      frontendUrl: config.frontendUrl,
    },
    result: {
      useful: usefulAt != null,
      usefulAtMs: usefulAt,
      manualClickAtMs: manualClickAt,
      durationMs: Date.now() - started,
      screenshotPath,
    },
    events: summary,
    samples,
    rawEvents: finalEvents,
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  await cdp.send('Page.close').catch(() => {})
  cdp.close()

  console.log(JSON.stringify({
    useful: report.result.useful,
    usefulAtMs: report.result.usefulAtMs,
    manualClickAtMs: report.result.manualClickAtMs,
    eventFirstMs: summary.first,
    eventCounts: summary.counts,
    reportPath,
    screenshotPath,
  }, null, 2))

  if (!report.result.useful) process.exitCode = 2
}

main().catch((error) => {
  console.error(`[rdp-first-paint-check] ${error.message}`)
  process.exitCode = 1
})
