#!/usr/bin/env node
/*
 * Terminal toolbar layout regression harness.
 *
 * This is intentionally static: the requested change is template structure/order,
 * and the real terminal CDP harness needs a reachable SSH host.
 *
 * Usage:
 *   node tools/frontend/terminal-ui-layout-harness.cjs
 */

const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const VIEW_PATH = path.join(REPO_ROOT, 'apps/frontend/src/views/TerminalView.vue')
const PANE_PATH = path.join(REPO_ROOT, 'apps/frontend/src/components/TerminalPane.vue')
const XTERM_ADAPTER_PATH = path.join(REPO_ROOT, 'apps/frontend/src/terminal/xterm-adapter.ts')

const source = fs.readFileSync(VIEW_PATH, 'utf8')
const paneSource = fs.readFileSync(PANE_PATH, 'utf8')
const xtermSource = fs.readFileSync(XTERM_ADAPTER_PATH, 'utf8')

function indexOfOrThrow(needle) {
  const index = source.indexOf(needle)
  if (index < 0) throw new Error(`Missing expected terminal template fragment: ${needle}`)
  return index
}

function sectionBetween(startNeedle, endNeedle) {
  const start = indexOfOrThrow(startNeedle)
  const end = indexOfOrThrow(endNeedle)
  if (end <= start) throw new Error(`Unexpected section order: ${startNeedle} should appear before ${endNeedle}`)
  return source.slice(start, end)
}

const tabBar = sectionBetween(
  '<NDropdown\n          placement="bottom-start"',
  '<!-- Top terminal controls -->',
)
const topControls = sectionBetween(
  '<!-- Top terminal controls -->',
  '<!-- ── Terminais + File Manager',
)
const rail = sectionBetween(
  '<div\n      v-if="termStore.tabs.length > 0"\n      v-show="!isTerminalFocusMode"\n      class="shrink-0 w-[58px]',
  '<transition name="slide">',
)
const railTop = sectionBetween(
  '<div class="flex flex-col items-center gap-2">',
  '<div class="flex flex-col items-center gap-2">\n        <NTooltip v-if="feedbackLicensed"',
)
const railBottom = sectionBetween(
  '<div class="flex flex-col items-center gap-2">\n        <NTooltip v-if="feedbackLicensed"',
  '<transition name="slide">',
)
const hostSwitcher = sectionBetween(
  '<!-- ── Modal: seleção de host',
  '<NModal\n      v-model:show="showSnippetQuickPicker"',
)

const findings = []

if (tabBar.includes('v-model:show="showTabSearch"')) {
  findings.push('Busca de abas voltou para a linha das guias.')
}
if (rail.includes('v-model:show="showTabSearch"')) {
  findings.push('Busca de abas voltou para o menu lateral.')
}
if (!topControls.includes('v-model:show="showTabSearch"')) {
  findings.push('Busca de abas nao esta no bloco de controles superiores.')
}
if (!topControls.includes('data-terminal-action="tab-search"')) {
  findings.push('Busca de abas sem seletor estavel data-terminal-action="tab-search".')
}
if (!topControls.includes('data-terminal-action="split-pane"')) {
  findings.push('Adicionar painel sem seletor estavel data-terminal-action="split-pane".')
}
const splitPaneIndex = topControls.indexOf('openSplitPicker')
const tabSearchIndex = topControls.indexOf('v-model:show="showTabSearch"')
if (splitPaneIndex < 0) findings.push('Controle adicionar painel nao encontrado nos controles superiores.')
if (tabSearchIndex < 0) findings.push('Lupa de busca nao encontrada nos controles superiores.')
if (splitPaneIndex >= 0 && tabSearchIndex >= 0 && splitPaneIndex > tabSearchIndex) {
  findings.push('Lupa de busca deve ficar depois de adicionar painel.')
}

const expectedRailOrder = [
  ['toolbar', 'style="order: 1"'],
  ['fullscreen', 'style="order: 2"'],
  ['files', 'style="order: 3"'],
  ['snippets', 'style="order: 4"'],
  ['share', 'style="order: 5"'],
  ['tunnels', 'style="order: 6"'],
  ['local-ai', 'style="order: 7"'],
]
for (const [name, marker] of expectedRailOrder) {
  const index = railTop.indexOf(marker)
  if (index < 0) {
    findings.push(`Controle ${name} sem marcador ${marker}.`)
    continue
  }
}

const feedbackIndex = railBottom.indexOf('openFeedbackFromTerminal')
const hostSwitcherIndex = railBottom.indexOf('openPicker')
const diagnosticsIndex = railBottom.indexOf('showDiagnostics = true')
if (feedbackIndex < 0) findings.push('Feedback nao esta na parte inferior do menu lateral.')
if (hostSwitcherIndex < 0) findings.push('Abrir host rapidamente nao esta na parte inferior do menu lateral.')
if (diagnosticsIndex < 0) findings.push('Diagnosticos nao esta na parte inferior do menu lateral.')
if (feedbackIndex >= 0 && hostSwitcherIndex >= 0 && feedbackIndex > hostSwitcherIndex) {
  findings.push('Feedback deve aparecer antes de abrir host rapidamente na parte inferior.')
}
if (hostSwitcherIndex >= 0 && diagnosticsIndex >= 0 && hostSwitcherIndex > diagnosticsIndex) {
  findings.push('Abrir host rapidamente deve aparecer antes de diagnosticos na parte inferior.')
}
if (!hostSwitcher.includes('data-terminal-host-switcher="true"')) {
  findings.push('Seletor de hosts sem marcador estavel data-terminal-host-switcher="true".')
}
if (hostSwitcher.includes('host.scope')) {
  findings.push('Seletor de hosts voltou a expor o escopo tecnico legado (personal/team/global).')
}

const paneChecks = [
  ['container', 'data-terminal-container="true"'],
  ['cols', ':data-terminal-cols="terminalMetrics.cols"'],
  ['rows', ':data-terminal-rows="terminalMetrics.rows"'],
  ['width', ':data-terminal-width="terminalMetrics.width"'],
  ['height', ':data-terminal-height="terminalMetrics.height"'],
  ['resize', ':data-terminal-resize-sent-at="terminalMetrics.lastResizeSentAt ?? \'\'"'],
  ['toolbar clear', 'data-terminal-action="clear"'],
  ['toolbar find', 'data-terminal-action="find"'],
  ['toolbar copy mode', 'data-terminal-action="copy-mode"'],
  ['toolbar paste', 'data-terminal-action="paste"'],
  ['toolbar info', 'data-terminal-action="info"'],
  ['hide toolbar', 'data-terminal-action="hide-toolbar"'],
  ['show toolbar', 'data-terminal-action="show-toolbar"'],
  ['floating controls', 'data-terminal-floating-controls="true"'],
  ['search bar', 'data-terminal-search-bar="true"'],
  ['info panel', 'data-terminal-info="true"'],
  ['copy mode', 'data-terminal-copy-mode="true"'],
  ['close copy mode', 'data-terminal-action="close-copy-mode"'],
]
for (const [name, marker] of paneChecks) {
  if (!paneSource.includes(marker)) findings.push(`TerminalPane sem marcador esperado para ${name}: ${marker}`)
}

const terminalFunctionChecks = [
  ['search next', 'searchNext(searchQuery)'],
  ['search prev', 'searchPrev(searchQuery)'],
  ['copy mode buffer', 'copyModeText.value = getBufferText()'],
  ['copy mode disables stdin', 'setDisableStdin(true)'],
  ['copy mode restores stdin', 'setDisableStdin(false)'],
  ['toolbar setting', 'setShowTerminalToolbar(false)'],
  ['floating toolbar setting', 'setShowTerminalToolbar(true)'],
  ['startup snippet prepare', 'prepareStartupSnippet(tabId)'],
  ['startup snippet targeted send', 'sendSnippetToTerminal(tabId'],
  ['startup snippet audited payload', 'sendSnippetToTerminal(tabId, { ...deserializeSnippetCommand(snippet.command), name: snippet.name }, snippet.id)'],
]
for (const [name, marker] of terminalFunctionChecks) {
  const haystack = name.startsWith('startup snippet') ? source : paneSource
  if (!haystack.includes(marker)) findings.push(`Fluxo de ${name} nao encontrado no ${name.startsWith('startup snippet') ? 'TerminalView' : 'TerminalPane'}.`)
}

if (!xtermSource.includes("cursorStyle: 'bar'")) {
  findings.push('Cursor do xterm deve permanecer em barra, evitando cursor bloco preenchido.')
}
if (!xtermSource.includes('cursorWidth: 1')) {
  findings.push('Cursor do xterm deve permanecer com largura 1.')
}
if (!xtermSource.includes('new CanvasAddon()')) {
  findings.push('CanvasAddon do xterm nao encontrado; isso pode alterar fidelidade/renderizacao.')
}
if (!xtermSource.includes('new FitAddon()')) {
  findings.push('FitAddon do xterm nao encontrado; isso afeta resize/rows/cols.')
}

if (!source.includes('data-terminal-startup-snippet-banner="true"')) {
  findings.push('Banner de macro de inicializacao sem seletor estavel.')
}
if (!source.includes("$t('terminal.startupSnippet.run')")) {
  findings.push('Acao para executar macro sugerida nao encontrada.')
}
if (!source.includes("$t('terminal.startupSnippet.skip')")) {
  findings.push('Acao para ignorar macro sugerida nao encontrada.')
}
if (!source.includes("tab.startupSnippetMode === 'auto'")) {
  findings.push('Modo automatico de macro de inicializacao nao encontrado.')
}
if (!source.includes('function focusTab(tabId: string) {\n  termStore.activate(tabId)')) {
  findings.push('Foco visual do painel dividido nao acompanha a ativacao da aba.')
}
if (!source.includes(':compact="hasAnySplit"')) {
  findings.push('TerminalPane nao recebe modo compacto durante a visualizacao dividida.')
}
if (!source.includes("$t('terminal.closeSplit') }}</NButton>")) {
  findings.push('Saida da visualizacao dividida nao possui acao textual visivel.')
}
if (!source.includes("'terminal.unreadActivityOne' : 'terminal.unreadActivityOther'")) {
  findings.push('Contador de atividade do painel dividido esta sem explicacao acessivel.')
}
if (!paneSource.includes('v-if="!props.compact && shouldShowRecommendedPreset"')) {
  findings.push('Preset recomendado continua ocupando a toolbar compacta do painel dividido.')
}
if (!paneSource.includes('v-if="!props.compact"\n        class="w-2 h-2 rounded-full')) {
  findings.push('Status duplicado continua visivel na toolbar compacta do painel dividido.')
}
const splitLayoutChecks = [
  ['resizer de colunas', 'data-terminal-split-resizer="column"'],
  ['resizer de linhas', 'data-terminal-split-resizer="row"'],
  ['resize por ponteiro', "@pointerdown=\"startSplitResize('column', $event)\""],
  ['resize por teclado', "@keydown=\"onSplitSeparatorKey('column', $event)\""],
  ['ordem visual independente', 'splitPaneOrder.value = moveSplitPane'],
  ['drag de painel', '@dragstart.stop="onSplitPaneDragStart($event, tab.id)"'],
  ['drop de painel', '@drop="onSplitPaneDrop($event, tab.id)"'],
  ['reordenacao acessivel', '@click.stop="shiftVisibleSplitPane(tab.id, -1)"'],
  ['modal de apelido', 'data-terminal-rename-modal="true"'],
  ['apelido separado', 'termStore.setCustomName(renameTabId.value, renameTabValue.value)'],
  ['nome exibido resolvido', '{{ terminalTabLabel(tab) }}'],
]
for (const [name, marker] of splitLayoutChecks) {
  if (!source.includes(marker)) findings.push(`Layout dividido sem ${name}: ${marker}`)
}

const report = {
  ok: findings.length === 0,
  sourcePaths: {
    view: VIEW_PATH,
    pane: PANE_PATH,
    xtermAdapter: XTERM_ADAPTER_PATH,
  },
  findings,
  checks: {
    tabSearchInTabBar: tabBar.includes('v-model:show="showTabSearch"'),
    tabSearchInTopControls: topControls.includes('v-model:show="showTabSearch"'),
    tabSearchInRail: rail.includes('v-model:show="showTabSearch"'),
    splitPaneIndex,
    tabSearchIndex,
    expectedRailOrder: expectedRailOrder.map(([name, marker]) => ({ name, marker, present: railTop.includes(marker) })),
    bottomOrder: { feedbackIndex, hostSwitcherIndex, diagnosticsIndex },
    hostSwitcher: {
      stableSelector: hostSwitcher.includes('data-terminal-host-switcher="true"'),
      exposesLegacyScope: hostSwitcher.includes('host.scope'),
    },
    paneChecks: paneChecks.map(([name, marker]) => ({ name, marker, present: paneSource.includes(marker) })),
    terminalFunctionChecks: terminalFunctionChecks.map(([name, marker]) => ({
      name,
      marker,
      present: (name.startsWith('startup snippet') ? source : paneSource).includes(marker),
    })),
    startupSnippet: {
      banner: source.includes('data-terminal-startup-snippet-banner="true"'),
      runAction: source.includes("$t('terminal.startupSnippet.run')"),
      skipAction: source.includes("$t('terminal.startupSnippet.skip')"),
      autoMode: source.includes("tab.startupSnippetMode === 'auto'"),
      functionChecks: terminalFunctionChecks
        .filter(([name]) => name.startsWith('startup snippet'))
        .map(([name, marker]) => ({ name, marker, present: source.includes(marker) })),
    },
    splitLayoutChecks: splitLayoutChecks.map(([name, marker]) => ({ name, marker, present: source.includes(marker) })),
    xterm: {
      cursorStyleBar: xtermSource.includes("cursorStyle: 'bar'"),
      cursorWidthOne: xtermSource.includes('cursorWidth: 1'),
      canvasAddon: xtermSource.includes('new CanvasAddon()'),
      fitAddon: xtermSource.includes('new FitAddon()'),
    },
  },
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
