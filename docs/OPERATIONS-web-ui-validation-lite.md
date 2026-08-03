# Operations - Validacao Web com Chromium/CDP

## Objetivo

Padronizar validacoes de interface web em navegador real quando uma alteracao depende de:

- estado autenticado;
- DOM renderizado;
- CSS computado;
- cache do Vite/browser;
- chamadas de API;
- eventos de frontend;
- console errors;
- comportamento que nao aparece em testes unitarios.

Use este procedimento para telas como `/hosts`, `/admin/acl`, dashboards, modais, drawers, sidebars e qualquer fluxo onde a pergunta seja: "o usuario realmente ve isso no browser?".

## Quando Usar

Use Chromium/CDP quando:

- a tela funciona no codigo, mas o usuario nao ve a mudanca;
- ha suspeita de bundle/cache antigo do Vite;
- precisa validar se o usuario autenticado caiu no login;
- precisa inspecionar `document.body.innerText`;
- precisa confirmar se um seletor existe, esta visivel e tem tamanho;
- precisa comparar duas portas ou dois servidores frontend, exemplo `5173` vs `5174`;
- precisa capturar erros de console ou excecoes antes de concluir a causa.

Para fluxos RDP/graficos, use tambem `docs/RDP-GUACD-TESTING.md`, pois la existem validacoes especificas de canvas, guacd e first paint.

## Fluxo Padrao

1. Confirmar API e frontend em execucao.
2. Abrir Chromium headless com CDP em uma porta dedicada.
3. Injetar sessao autenticada antes da navegacao.
4. Navegar para a URL alvo com query unica para reduzir cache, exemplo `?check=${Date.now()}`.
5. Desabilitar cache via CDP.
6. Esperar a tela estabilizar.
7. Inspecionar texto, seletores, estilos computados, tamanho e visibilidade.
8. Capturar erros de console/rede quando a tela ficar em branco ou parcial.
9. Comparar com outra porta/servidor se houver suspeita de Vite stale transform.
10. Remover scripts temporarios criados para a investigacao.

## Autenticacao de Dev

Para testes locais, preferir uma destas opcoes:

1. Reusar token real do browser quando o teste precisa reproduzir exatamente o usuario.
2. Gerar JWT local com `JWT_SECRET` de `apps/backend/.env` para um usuario seed/admin.
3. Fazer login real via UI somente quando a investigacao envolve o proprio fluxo de login/MFA.

Quando gerar JWT local, injete antes da pagina carregar:

```js
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    localStorage.setItem('na_access_token', '<token>');
    localStorage.setItem('na_refresh_token', 'dev-check-refresh-placeholder');
  `,
})
```

Isso evita o falso negativo em que o teste cai em `/auth/login` e inspeciona a tela errada.

## Chromium Headless

Com Linux Chromium:

```bash
chromium-browser \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --remote-debugging-port=9339 \
  --window-size=1280,900 \
  about:blank
```

Observacoes do sandbox:

- Em ambientes com sandbox de execucao, a conexao do script Node ao CDP local
  pode falhar com `EPERM 127.0.0.1:<porta>`.
- Quando isso acontecer, rerodar o mesmo comando do harness com permissao
  elevada/aprovada, pois o teste precisa abrir socket local para o DevTools
  Protocol.
- Scripts executados via `tsx` tambem podem falhar com
  `listen EPERM /tmp/tsx-*/...pipe`; nesse caso, rerodar o mesmo comando com
  permissao elevada pelo mesmo motivo de sandbox local.
- Nao interpretar esse `EPERM` como falha do produto; e uma restricao do runner
  de automacao.
- Manter uma porta CDP dedicada por harness evita cruzar estado entre testes
  simultaneos.

Em WSL, se o Chromium Linux falhar por sandbox/Snap/perfil, usar Chrome do Windows como no guia de RDP:

```bash
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new \
  --remote-debugging-port=9224 \
  --user-data-dir="C:\\Temp\\nodeaccess-chrome-codex" \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  about:blank
```

## Checks Minimos

Toda validacao web autenticada deve registrar:

- URL final (`location.href`);
- se caiu ou nao no login;
- trecho inicial de `document.body.innerText`;
- seletores esperados encontrados;
- visibilidade real (`offsetWidth`, `offsetHeight` ou `getClientRects()`);
- `getBoundingClientRect()` dos elementos criticos;
- `getComputedStyle()` quando o bug for visual;
- erros de console/excecoes;
- porta/frontend testado.

Exemplo de retorno util:

```js
return {
  location: location.href,
  bodyStart: document.body.innerText.slice(0, 300),
  hasLogin: document.body.innerText.includes('Email') && document.body.innerText.includes('Continue'),
  count: document.querySelectorAll('.inventory-folder-node-count').length,
  items: [...document.querySelectorAll('.inventory-folder-node-count')].map((el) => ({
    text: el.textContent,
    styleAttr: el.getAttribute('style'),
    computed: {
      display: getComputedStyle(el).display,
      minWidth: getComputedStyle(el).minWidth,
      padding: getComputedStyle(el).padding,
      background: getComputedStyle(el).backgroundColor,
    },
    rect: (() => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height, x: r.x, y: r.y }
    })(),
    visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    parentText: el.parentElement?.textContent || '',
  })),
}
```

## Diagnostico de Cache/Vite

Quando o DOM renderizado nao bate com o arquivo local:

1. Comparar o modulo servido pelo Vite:

```bash
curl -s http://127.0.0.1:5173/src/views/HostsView.vue | rg "trecho-esperado|classe-esperada"
```

2. Comparar com uma query nova:

```bash
curl -s "http://127.0.0.1:5173/src/views/HostsView.vue?t=999999999" | rg "trecho-esperado|classe-esperada"
```

3. Subir uma segunda porta para isolar cache/processo antigo:

```bash
npm run dev -w apps/frontend -- --host 127.0.0.1 --port 5174
```

4. Validar a mesma tela nas duas portas.

Sinal de Vite stale transform:

- `5173` serve transform antigo;
- `5174` serve transform novo;
- o browser autenticado em `5174` mostra o elemento correto;
- `typecheck` passa.

Acao recomendada:

- reiniciar o dev server antigo;
- hard refresh com cache desabilitado;
- limpar perfil temporario do browser usado no teste se necessario.

## Captura de Erros

Antes da navegacao, registre erros globais:

```js
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__webCheckErrors = [];
    window.addEventListener('error', (event) => {
      window.__webCheckErrors.push({ type: 'error', message: event.message, source: event.filename, line: event.lineno });
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__webCheckErrors.push({ type: 'unhandledrejection', reason: String(event.reason) });
    });
  `,
})
```

Na avaliacao final, incluir:

```js
errors: window.__webCheckErrors || []
```

Se a tela estiver em branco, priorizar console/excecoes antes de alterar UI.

## Template de Script Temporario

Use scripts temporarios apenas durante a investigacao e remova antes de concluir.

Estrutura recomendada:

```js
// tmp-web-ui-check.cjs
const crypto = require('crypto')
const fs = require('fs')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const FRONTEND_BASE = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const CDP_PORT = Number(process.env.CDP_PORT || 9339)

function readJwtSecret() {
  const envFile = fs.readFileSync('apps/backend/.env', 'utf8')
  const match = envFile.match(/^JWT_SECRET=(.+)$/m)
  if (!match) throw new Error('JWT_SECRET not found')
  return match[1].trim().replace(/^"|"$/g, '')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function signJwt(payload, secret, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify({ iat: now, exp: now + ttlSeconds, ...payload }))
  const data = `${header}.${body}`
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${data}.${signature}`
}

// Implementar cliente CDP pequeno ou reaproveitar um script existente.
// Minimo: Runtime.enable, Page.enable, Network.enable, Network.setCacheDisabled,
// Page.addScriptToEvaluateOnNewDocument, Page.navigate e Runtime.evaluate.
```

Campos comuns do JWT local de admin:

```js
{
  sub: '1',
  email: 'admin@nodeaccess.local',
  role: 'admin',
  tenantId: 1,
  canManageHosts: true,
  canViewLiveSessions: true,
  forcePasswordChange: false,
  stage: 'authenticated',
}
```

## Criterios de Sucesso

Considere a validacao suficiente quando:

- a tela alvo carregou autenticada;
- os seletores esperados existem;
- elementos criticos estao visiveis e com dimensoes coerentes;
- estilos computados batem com a intencao visual;
- nao ha erro de console bloqueante;
- o frontend testado e o arquivo local estao na mesma versao;
- `npm run typecheck -w apps/frontend` passa quando a mudanca tocou Vue/TS.

## Armadilhas Comuns

- Testar sem token e concluir sobre a tela de login.
- Validar apenas HTML fonte em vez do DOM renderizado.
- Usar screenshot sem inspecionar `getComputedStyle` em bug de CSS.
- Confundir elemento presente com elemento visivel.
- Ignorar cache do Vite quando a porta antiga serve transform antigo.
- Deixar script temporario no repositorio.
- Comparar portas diferentes sem registrar qual backend/API cada frontend esta usando.
