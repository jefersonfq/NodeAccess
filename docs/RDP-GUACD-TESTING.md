# RDP/guacd test methodology

Use this checklist when validating RDP rendering, resolution changes, first paint behavior, and rollback candidates.

## Goal

- Confirm the browser RDP session reaches the same initial state as Windows `mstsc`: remote login screen without requiring a first mouse click.
- Confirm canvas quality is not degraded by CSS scaling or nearest-neighbor rendering.
- Confirm guacd receives a controlled initial resolution and only receives later `size` instructions when the viewport actually changes.

## Preconditions

- `guacd` reachable on `127.0.0.1:4822`.
- NodeAccess dev stack running with graphical gateway enabled.
- Target host reachable from the machine running guacd.
- If comparing against Windows behavior, validate the same host with `mstsc.exe` first and record whether it shows the Windows login screen.
- Confirm the API/gateway process under test is the one serving `localhost`. If `3000` or `3001` are already in use, a new frontend can still talk to an older gateway through `VITE_WS_URL=ws://localhost/ws`.

## Protocol guardrails

- Keep RDP authentication enabled for remote graphical login. For hosts without stored credentials, send empty `username`/`password` but keep `disable-auth=false`; this allows the Windows/RDP login screen to appear like `mstsc`.
- Do not send duplicate initial `size` instructions immediately after `graphical_gateway_connected`. The initial width/height/dpi are already sent in the WebSocket query and guacd handshake.
- Treat synthetic mouse wakeups carefully. A wakeup after the first `sync` or after a real resize is acceptable; a burst of `mouse` before the remote screen is ready can change the negotiation timing.
- For HiDPI quality, keep `imageRendering` as `auto` and validate the canvas backing resolution against CSS size times DPR, capped by the frontend metric policy.
- When `resize-method=reconnect`, every forwarded `size` may trigger heavier RDP behavior. Debounce and deduplicate resize messages before blaming guacd.
- A browser error containing `wrong security type`, `NLA`, `CredSSP`, `authentication`, or `credentials` should be treated as an RDP negotiation/authentication issue first, not as a canvas rendering issue.

## Browser capture path

Linux Chromium may fail in this environment when the available binary is a Snap wrapper and `/run/snapd` is read-only. Prefer Windows Chrome through WSL:

```bash
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new \
  --remote-debugging-port=9223 \
  --user-data-dir="C:\\Temp\\nodeaccess-chrome-codex" \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  about:blank
```

The CDP endpoint is normally reachable only from the Windows loopback side. Use Windows Node when driving CDP:

```bash
"/mnt/c/Program Files/nodejs/node.exe" tmp-cdp-rdp-check.cjs
```

### Reusable first-paint/click timing check

Use the repository script below for the next RDP click-to-display battery. It opens the graphical page through Chrome DevTools Protocol, injects an authenticated token, enables `rdpDebug`, samples the canvas, records frontend `[graphical-rdp]` events, and saves a local JSON report plus PNG screenshot under `tools/rdp/reports/`. Generated reports are intentionally ignored by Git.

Baseline without a manual click:

```bash
"/mnt/c/Program Files/nodejs/node.exe" tools/rdp/rdp-first-paint-check.cjs \
  --frontend-url=http://localhost:5174/graphical/829?rdpDebug=1 \
  --device-scale-factor=1.5 \
  --timeout-ms=45000
```

Comparison run with a controlled synthetic click after 5 seconds:

```bash
"/mnt/c/Program Files/nodejs/node.exe" tools/rdp/rdp-first-paint-check.cjs \
  --frontend-url=http://localhost:5174/graphical/829?rdpDebug=1 \
  --device-scale-factor=1.5 \
  --timeout-ms=45000 \
  --manual-click-ms=5000 \
  --click-x-ratio=0.5 \
  --click-y-ratio=0.4
```

When invoking Windows Node from WSL, prefer CLI arguments over one-off shell environment variables. Plain WSL environment assignments may not reach the Windows process unless `WSLENV` is configured.

Useful environment overrides:

- `FRONTEND_URL=http://localhost:5174/graphical/829?rdpDebug=1`
- `HOST_ID=829` when `FRONTEND_URL` is not set.
- `CDP_BASE=http://127.0.0.1:9223`
- `TIMEOUT_MS=30000`
- `VIEWPORT_WIDTH=1280 VIEWPORT_HEIGHT=720 DEVICE_SCALE_FACTOR=1`
- `USEFUL_BRIGHT_MIN=20 USEFUL_UNIQUE_MIN=4`
- `MIN_IMAGE_BYTES=1000 MIN_IMAGE_AREA=1024`
- `OUTPUT_DIR=tools/rdp/reports`

Authentication order:

1. `RDP_TEST_ACCESS_TOKEN`, when a real browser token should be reused.
2. `JWT_SECRET`, read from `.env`/backend env files when available, to mint a local dev JWT for the seeded admin.
3. `LOGIN_EMAIL`/`LOGIN_PASSWORD` plus optional `LOGIN_TOTP_CODE`; without the MFA code the script stops with a clear message.

Success signal:

- `useful=true` and `usefulAtMs` filled in the script output.
- Event timeline includes `gateway-connected`, one or more `rdp-activation-wakeup`/`mouse-wakeup-click`, `render-command`, and `render-complete`.
- Canvas sample crosses `bright >= 20` and `unique >= 4`.
- At least one RDP image crosses `MIN_IMAGE_BYTES` or `MIN_IMAGE_AREA`; this prevents cursor-only images from passing as first paint.
- The saved PNG shows the Windows login/desktop rather than a uniform dark frame.

When comparing runs, preserve both JSON reports. The key fields are `result.usefulAtMs`, `result.manualClickAtMs`, `events.first`, `events.counts`, and the last `samples[].canvas` values.

The CDP script should:

- Create a local test JWT using `JWT_SECRET` from `.env`.
- Inject `localStorage.na_access_token` with `Page.addScriptToEvaluateOnNewDocument`.
- Set device metrics, including a non-1 DPR such as `1.5`.
- Navigate to `/graphical/<hostId>`.
- Wait for connection or error state.
- Read `document.body.innerText`.
- Read canvas metrics: CSS width/height, backing `canvas.width/height`, `window.devicePixelRatio`, and `canvas.style.imageRendering`.
- Capture a screenshot to `C:\Temp\nodeaccess-rdp-check.png`.

Reusable temporary script template:

```js
// tmp-cdp-rdp-check.cjs
const fs = require('fs')
const http = require('http')
const jwt = require('jsonwebtoken')
const WebSocket = require('ws')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174/graphical/829'
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9224'
const JWT_SECRET = process.env.JWT_SECRET || '<copy JWT_SECRET from .env>'
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH || 'C:\\Temp\\nodeaccess-rdp-check.png'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (err) { reject(err) }
      })
    }).on('error', reject)
  })
}

function createCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (!msg.id || !pending.has(msg.id)) return
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  })
  return {
    ready: () => new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    }),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const nextId = ++id
      pending.set(nextId, { resolve, reject })
      ws.send(JSON.stringify({ id: nextId, method, params }))
    }),
    close: () => ws.close(),
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  return result.result.value
}

async function main() {
  const targets = await getJson(`${CDP_BASE}/json/list`)
  const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  if (!pageTarget) throw new Error('No CDP page target found')
  const cdp = createCdp(pageTarget.webSocketDebuggerUrl)
  await cdp.ready()

  const token = jwt.sign({
    sub: '1',
    email: 'codex.local@example.invalid',
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: 1,
    canManageHosts: true,
    forcePasswordChange: false,
    stage: 'authenticated',
  }, JWT_SECRET, { expiresIn: '30m' })

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1.5,
    mobile: false,
  })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('na_access_token', ${JSON.stringify(token)});`,
  })
  await cdp.send('Page.navigate', { url: FRONTEND_URL })
  await wait(15000)

  const metrics = await evaluate(cdp, `(() => {
    const canvas = document.querySelector('canvas')
    const rect = canvas?.getBoundingClientRect()
    return {
      url: location.href,
      body: document.body.innerText.slice(0, 1800),
      dpr: window.devicePixelRatio,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        imageRendering: getComputedStyle(canvas).imageRendering,
      } : null,
    }
  })()`)

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'))
  console.log(JSON.stringify({ metrics, screenshotPath: SCREENSHOT_PATH }, null, 2))
  cdp.close()
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
```

Expected canvas quality signals:

- `canvas.style.imageRendering` is `auto`.
- Backing resolution is approximately CSS size times DPR, capped by the frontend display metric policy.
- No forced pixelated scaling.
- Text in the RDP login screen or error placeholder is readable in the screenshot.

## Gateway log checks

During browser validation, watch for:

- `graphical.gateway.guacd.connect.start` with expected `initialWidth`, `initialHeight`, and `initialDpi`.
- `graphical.gateway.client.message` forwarding `size` only when the viewport actually changes.
- No burst of duplicate initial `size` or synthetic `mouse` instructions immediately after `graphical_gateway_connected`.
- `graphical.gateway.remote.data` opcodes such as `size`, `img`, `blob`, `end`, `cursor`, `sync`.
- Any guacd `error` instruction, especially messages containing `wrong security type`, `NLA`, `CredSSP`, `authentication`, or `credentials`.

For deep diagnostics, start the dev stack with backend frame debugging and open the frontend with RDP debug enabled:

```bash
GRAPHICAL_DEBUG_FRAMES=true VITE_WS_URL=ws://localhost:3001 npm run dev:raw
```

Then open:

```text
http://localhost:5173/graphical/<hostId>?rdpDebug=1
```

Frontend console logs use the `[graphical-rdp]` prefix and include:

- `gateway-connected`
- `send-size`
- `mouse-wakeup-start`
- `mouse-wakeup-click`
- `client-input`
- `guacd-instruction`
- `render-command`
- `render-complete`
- `gateway-input-forwarded`

Backend logs include:

- `graphical.gateway.remote.debug`: summarized guacd instructions for a received frame; `blob` payloads are redacted to length only.
- `graphical.gateway.client.debug`: forwarded client `mouse`, `key`, and `size` args.

Use these together to answer four questions quickly:

1. Did the frontend send the wakeup/click? Check `client-input` and `mouse-wakeup-click`.
2. Did the gateway forward it? Check `graphical.gateway.client.debug`.
3. Did guacd respond with new image data after input? Check `graphical.gateway.remote.debug` for `img`, `blob`, `end`.
4. Did the canvas actually change? Check `render-complete.canvas.unique` and `render-complete.canvas.bright`.

## Direct guacd matrix

Use a temporary Node script only when isolating browser/gateway behavior from guacd/RDP behavior. The script should connect directly to `127.0.0.1:4822`, select `rdp`, send `size/audio/video/image/connect`, reply to `sync` and `blob` with `sync`/`ack`, and wait around 10 seconds.

Run a matrix across:

- `security`: `any`, `rdp`, `tls`, `nla`
- `disable-auth`: `true`, `false`
- same host, port, layout, color depth, resize method, and quality options used by the backend adapter

Record for each case:

- ready opcode
- whether an `error` opcode appears
- whether display opcodes appear (`size`, `img`, `blob`, `end`, `cursor`, `sync`)
- first error snippet, if present

Interpretation:

- If direct guacd shows display opcodes and browser path fails, inspect frontend/gateway timing, duplicate `size`, mouse wakeup, query metrics, and credentials mode.
- If direct guacd fails for the same security mode, inspect RDP server policy, NLA/CredSSP requirements, credentials, certificates, and guacd adapter options.
- In the last known direct matrix, `security=any|rdp|tls|nla` with both `disable-auth=true|false` reached `ready` and display opcodes without reproducing the browser `wrong security type` error. That pointed investigation back to browser/gateway timing and adapter connect args.

Reusable direct-guacd skeleton:

```js
// tmp-guacd-rdp-matrix.cjs
const net = require('net')

function enc(opcode, ...args) {
  return [opcode, ...args].map((value) => `${Array.from(String(value)).length}.${value}`).join(',') + ';'
}

function parseOne(raw) {
  const values = []
  let offset = 0
  while (offset < raw.length) {
    const dot = raw.indexOf('.', offset)
    if (dot < 0) return null
    const len = Number(raw.slice(offset, dot))
    const start = dot + 1
    const end = start + len
    if (raw.length <= end) return null
    values.push(raw.slice(start, end))
    const sep = raw[end]
    if (sep === ';') return { opcode: values[0], args: values.slice(1), rest: raw.slice(end + 1) }
    if (sep !== ',') throw new Error(`bad separator ${sep}`)
    offset = end + 1
  }
  return null
}

function readInstruction(socket, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => cleanup(reject, new Error('timeout')), timeoutMs)
    const cleanup = (done, value) => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      done(value)
    }
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      const parsed = parseOne(buffer)
      if (parsed) cleanup(resolve, parsed)
    }
    const onError = (err) => cleanup(reject, err)
    const onClose = () => cleanup(reject, new Error('closed'))
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

function connectValues(argNames, options) {
  const map = {
    VERSION_1_5_0: 'VERSION_1_5_0',
    hostname: process.env.RDP_HOST || '<target-ip>',
    port: process.env.RDP_PORT || '3389',
    domain: '',
    username: '',
    password: '',
    width: '1280',
    height: '720',
    dpi: '96',
    'color-depth': '24',
    'server-layout': 'pt-br-qwerty',
    security: options.security,
    'ignore-cert': 'true',
    'disable-auth': String(options.disableAuth),
    'resize-method': 'reconnect',
    'enable-font-smoothing': 'true',
    'disable-gfx': 'true',
    'disable-bitmap-caching': 'true',
    'disable-offscreen-caching': 'true',
    'force-lossless': 'true',
  }
  return argNames.map((name) => map[name] ?? '')
}

async function runCase(options) {
  const socket = net.createConnection({ host: '127.0.0.1', port: 4822 })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.write(enc('select', 'rdp'))
  const args = await readInstruction(socket)
  socket.write(enc('size', '1280', '720', '96'))
  socket.write(enc('audio'))
  socket.write(enc('video'))
  socket.write(enc('image', 'image/png', 'image/jpeg'))
  socket.write(enc('connect', ...connectValues(args.args, options)))
  const ready = await readInstruction(socket)

  const counts = {}
  let data = ready.rest || ''
  let buffer = ''
  const processData = (text) => {
    data += text
    buffer += text
    while (buffer) {
      const parsed = parseOne(buffer)
      if (!parsed) return
      counts[parsed.opcode] = (counts[parsed.opcode] || 0) + 1
      if (parsed.opcode === 'sync') socket.write(enc('sync', parsed.args[0] || '0'))
      if (parsed.opcode === 'blob') socket.write(enc('ack', parsed.args[0] || '0', 'OK', '0'))
      buffer = parsed.rest
    }
  }
  if (ready.rest) processData(ready.rest)
  await new Promise((resolve) => {
    setTimeout(resolve, 10000)
    socket.on('data', (chunk) => processData(chunk.toString('utf8')))
  })
  socket.destroy()
  return {
    ...options,
    ready: ready.opcode,
    hasError: data.includes('5.error'),
    hasDisplay: Boolean(counts.size || counts.img || counts.blob || counts.cursor),
    counts,
  }
}

async function main() {
  for (const security of ['any', 'rdp', 'tls', 'nla']) {
    for (const disableAuth of [true, false]) {
      try {
        console.log(JSON.stringify(await runCase({ security, disableAuth })))
      } catch (err) {
        console.log(JSON.stringify({ security, disableAuth, error: err.message }))
      }
    }
  }
}

main()
```

## Resolution-change validation

1. Open the graphical session.
2. Confirm the initial login screen appears without a manual click.
3. Open details and record remote and viewport resolution.
4. Resize the browser window or enter fullscreen.
5. Confirm exactly one meaningful `size` is forwarded after the debounce window.
6. Confirm the remote display updates without requiring a click.
7. Confirm no error state appears after the resize.

## Cleanup

- Stop the dev server.
- Stop Windows Chrome headless.
- Remove temporary scripts such as `tmp-cdp-rdp-check.cjs` and `tmp-guacd-rdp-matrix.cjs`.
- Keep screenshots in `C:\Temp` only while comparing results.

## Last validation notes

- If a browser run still shows the credentials fallback, first confirm the gateway process was restarted with the current adapter code. A stale gateway can keep returning the old `disable-auth` behavior.
- `3000/3001` conflicts during `npm run dev:raw` mean the backend/gateway under test did not start. Do not trust browser results from that run as validation of backend changes.
- For dev validation, prefer starting with `VITE_WS_URL=ws://localhost:3001 npm run dev:raw`; otherwise `.env` may point the frontend to `ws://localhost/ws` through nginx on port `80`.
- A successful canvas quality check from the last run was DPR `1.5`, canvas backing `1494x540`, CSS size `996x360`, and `imageRendering: auto`.
- On the June 28 validation against host `829`/`TESTE-RDP`, the gateway under test confirmed `disable-auth=false`, empty username/password, `resize-method=reconnect`, and no duplicate client `size`/`mouse` before failure. The remote still returned guacd `error` with args `["Server refused connection (wrong security type?)", "519"]`.
- Direct guacd tests against the same host returned the same error for `security=any`, `rdp`, `tls`, and `nla`, including a 25s NLA run at `1280x720@96dpi` and at `1494x900@144dpi`. Treat this as remote RDP/security negotiation, not canvas or browser rendering.
- After the remote machine was unlocked, the same browser/CDP path reached `Gateway conectado` with no credentials fallback and no guacd `error`. Canvas metrics were DPR `1.5`, backing `1492x900`, CSS `995x600`, `imageRendering:auto`.
- The unlocked validation still rendered a uniform dark canvas: details showed `Mensagens do gateway: 137`, `Última instrução: sync`, `Resumo de instruções: sync:135 size:2 img:2 blob:2 end:2 mouse:1 cursor:1 set:1`, `Comandos renderizados: 5`, and `Falhas ao desenhar imagem: 0`.
- Sending `Ctrl+Alt+Del` from the UI was forwarded (`Entradas enviadas: 6`, last opcode `key`) but did not produce additional image frames in that run. If this persists with an interactive user test, investigate whether guacd is receiving only blank initial bitmaps from the remote or whether streamed image commands are being decoded into a black frame.
- A follow-up test added an automatic initial mouse wakeup click: move at center plus left down/up once after the first `sync`. The isolated frontend at `5174` confirmed `Entradas enviadas: 3` and `Entradas encaminhadas: 3`, but the headless canvas remained a uniform dark frame.
- A later CDP test dispatched a real browser click on the canvas after 35s. The UI registered `Eventos de entrada: 3`, `Entradas enviadas: 6`, and `Entradas encaminhadas: 5`, but guacd still sent no additional `img/blob` frames, only more `sync`. This did not reproduce the manual browser behavior where a user click reportedly makes the screen arrive.
- Frontend/backend debug forwarding is available with `?rdpDebug=1` or `localStorage.na_rdp_debug=1` plus backend `GRAPHICAL_DEBUG_FRAMES=true`. During the click-to-display investigation, watch for `gateway-connected`, `placeholder-draw`, `placeholder-skip`, `render-command`, `image-draw-complete`, and `render-complete`.
- If `image-draw-complete` shows non-empty image/canvas samples but the browser stays dark, check whether `drawDisplayPlaceholder()` ran after the first real render. The frontend now skips placeholder drawing while connected once `guacdRenderCount > 0`; a `placeholder-skip` entry is expected in this race.
- On the next interactive run, compare counters immediately before and after the manual click. In the June 29 run, renders increased from `5` to `46` after interaction, which indicates the click can trigger additional guacd display updates instead of only forcing a local browser repaint.
- The frontend schedules bounded RDP activation wakeups after `graphical_gateway_connected`: upper-center/center mouse move/click attempts in the first few seconds. They stop when the user has interacted, the session is no longer connected/RDP, or the canvas sample looks useful (`bright >= 20` and `unique >= 4`). In debug logs, expect `rdp-activation-wakeup` or `rdp-activation-wakeup-skip`.
- In session `3972`, automatic clicks at the exact center (`x=822,y=412`) were forwarded but did not unlock useful frames; render count stayed at `5`. Manual successful clicks were observed closer to the upper-center login area (`y` around `324` on an `823px` high canvas), so activation attempts now include `yRatio=0.4`.
- In the follow-up run, the adjusted activation emitted `rdp-activation-wakeup` at `x=822,y=329`. A subsequent session reached useful full-canvas image output: render count `15`, PNG around `14392` bytes, and canvas sample `bright=77`, `unique=8`. Treat that as the expected success signal for the no-manual-click path.
- On the June 29 internal harness run through Windows Chrome CDP + Windows Node, WSL shell environment variables did not reach the Windows Node process. Use CLI arguments for `--frontend-url`, `--timeout-ms`, `--device-scale-factor`, and click timing.
- The first version of `tools/rdp/rdp-first-paint-check.cjs` produced false positives because the placeholder canvas and cursor-only RDP images crossed simple pixel thresholds. The script now requires a remote render plus useful canvas sample plus minimum image bytes/area.
- Clean baseline after that correction: host `829`, frontend `5174`, DPR `1.5`, timeout `45s`, no manual click. Result: `useful=false`; `gateway-connected` around `1463ms`; `rdp-activation-wakeup` around `1633ms`; `render-complete=5`; `image-draw-complete=2`; then only `sync`; final canvas `1492x780`, CSS `995x520`, `bright=825`, `unique=1`.
- Controlled synthetic click comparison: same setup with `--manual-click-ms=5000 --click-x-ratio=0.5 --click-y-ratio=0.4`. Result: `manualClickAtMs=5052`, but still `useful=false`; counters stayed equivalent to baseline except one skipped later activation. This confirms the synthetic click reached frontend/gateway but did not cause guacd to send useful desktop frames in headless validation.
- guacd logs for those runs showed successful RDP negotiation: `Security mode: Negotiate (ANY)`, resolution `1492x780 at 144 DPI`, `Resize method: reconnect`, framebuffer formats set, and `CLIPRDR`/`rdpdr`/`rdpsnd` connected. No security/auth error appeared. Treat the failure as post-handshake RDP framebuffer/update behavior, not login/auth negotiation.
- Interactive browser validation then captured the missing trigger: after real mouse movement/clicks, guacd emitted a layer `0` image frame with `blob` chunks around `8064 + 5064 chars` and total frame bytes around `13229`, followed by useful canvas output. The successful click path included pointer activity near `x=202,y=349` on a `1608x680` remote surface, roughly `xRatio=0.13,yRatio=0.51`.
- The frontend RDP activation schedule now includes late attempts at `xRatio=0.13,yRatio=0.51` after the original upper-center attempts, and `hasUsefulCanvasFrame()` requires a meaningful remote image before stopping. This avoids treating placeholders/cursor-only images as success.
- Post-adjustment headless validation through Windows Chrome CDP on port `9224`, frontend `5174`, DPR `1.5`, timeout `45s`, no manual click: `useful=true`, `usefulAtMs=6672`, `rdp-activation-wakeup=6`, `image-draw-complete=5`, max image `13708` bytes, final canvas `bright=813`, `unique=11`. Screenshot showed the XRDP login dialog. Report: `tools/rdp/reports/rdp-first-paint-2026-06-29T14-11-44-714Z.json`.
- Follow-up RDP option matrix on June 29 used the same harness, Chrome CDP `9224`, frontend `5174`, and timeout `25s`. Results:
  - `reconnect + disable-gfx=true + force-lossless=true + DPR 1.5`: `usefulAtMs=10168`, canvas `1492x780`.
  - `display-update + disable-gfx=true + force-lossless=true + DPR 1.5`: `usefulAtMs=4040`, canvas `1492x780`.
  - `reconnect + disable-gfx=false + force-lossless=true + DPR 1.5`: `usefulAtMs=7226`, canvas `1492x780`.
  - `reconnect + disable-gfx=true + force-lossless=false + DPR 1.5`: `usefulAtMs=3271`, canvas `1492x780`.
  - `reconnect + disable-gfx=true + force-lossless=false + DPR 1.0`: `usefulAtMs=2935`, canvas `996x520`.
  - `display-update + disable-gfx=true + force-lossless=false + DPR 1.5`: `usefulAtMs=7160`, canvas `1492x780`.
- Recommendation from that matrix: keep `resize-method=reconnect`, keep `disable-gfx=true`, change `force-lossless=false`, and keep high-DPI browser scaling. DPR `1.0` was slightly faster but reduces canvas backing resolution and is not preferred for quality.
- Keep `GRAPHICAL_DEBUG_FRAMES=true` throttled: log first frames, non-`sync` frames, and periodic samples only. Full `sync` logging can hide the useful image/blob/canvas events and makes the next validation slower.
- Keep temporary scripts out of the repository root after testing; preserve reusable snippets here instead.
