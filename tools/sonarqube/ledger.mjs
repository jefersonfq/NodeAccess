import { readIssue, publicIssue } from '../shared/sonar-issue-id.cjs'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function signature(issue) {
  const file = issue.component?.replace(/^[^:]+:/, '') ?? issue.file
  if (!issue.rule || !file || !issue.hash) throw new Error('Finding lacks rule/path/content hash; cannot compare safely')
  return createHash('sha256').update(JSON.stringify([issue.rule, file, issue.hash])).digest('hex')
}
export function compareFindings(issues, accepted) {
  if (accepted.schemaVersion !== 1 || !Array.isArray(accepted.findings)) throw new Error('Invalid reviewed baseline')
  const allowances = new Map()
  for (const row of accepted.findings) {
    if (!row.reason?.trim() || !row.evidence?.length || row.status !== 'context_reviewed'
      || !/^[a-f0-9]{64}$/.test(row.signature) || !Number.isSafeInteger(row.count) || row.count < 1
      || allowances.has(row.signature)) throw new Error('Baseline requires unique signatures, review rationale and evidence')
    allowances.set(row.signature, row.count)
  }
  const unexpected = []
  for (const issue of issues) {
    const key = signature(issue), remaining = allowances.get(key) ?? 0
    if (remaining > 0) allowances.set(key, remaining - 1)
    else unexpected.push({ key: issue.key, rule: issue.rule, file: issue.component.replace(/^[^:]+:/, ''), line: issue.line ?? null })
  }
  return { passed: unexpected.length === 0, reviewed: issues.length - unexpected.length, unexpected,
    absentReviewedOccurrences: [...allowances.values()].reduce((a, b) => a + b, 0) }
}
export function discoverFindings(original, current = [], previous = []) {
  previous = previous.map(issue => readIssue(issue))
  const known = new Set(original.map(i => i.key))
  const rows = []
  const fresh = [...current].sort((a, b) => a.component.localeCompare(b.component) || (a.line ?? 0) - (b.line ?? 0) || a.key.localeCompare(b.key))
  for (const issue of [...previous, ...fresh]) {
    if (known.has(issue.key)) continue
    signature(issue)
    known.add(issue.key)
    rows.push(Object.fromEntries(['key', 'rule', 'component', 'line', 'hash', 'severity', 'type'].map(key => [key, issue[key] ?? null])))
  }
  return rows
}
export function catalog(issues, decisions = [], current = null, discovered = []) {
  const byKey = new Map()
  for (const entry of decisions) {
    const item = readIssue(entry)
    if (byKey.has(item.key)) throw new Error('Duplicate disposition for issue')
    byKey.set(item.key, item)
  }
  const currentKeys = current && new Set(current.map(i => i.key))
  const sortIssues = list => [...list].sort((a, b) => a.component.localeCompare(b.component) || (a.line ?? 0) - (b.line ?? 0) || a.key.localeCompare(b.key))
  const originalKeys = new Set(issues.map(i => i.key))
  const tracked = new Map(discovered.filter(i => !originalKeys.has(i.key)).map(i => [i.key, i]))
  const additions = [...tracked.values(), ...sortIssues(current ? current.filter(i => !originalKeys.has(i.key) && !tracked.has(i.key)) : [])]
  return [...sortIssues(issues), ...additions].map((i, index) => {
    const decision = byKey.get(i.key), file = i.component.replace(/^[^:]+:/, '')
    const domain = file.startsWith('apps/frontend/') ? 'Frontend' : /^(tools|scripts)\//.test(file) ? 'Ferramentas' : 'Backend / shared / agent'
    return { id: `SQ-${String(index + 1).padStart(4, '0')}`, key: i.key, rule: i.rule, type: i.type, severity: i.severity,
      file, baselineLine: i.line ?? null, domain, signature: signature(i),
      status: decision?.status ?? 'pending', observed: currentKeys ? currentKeys.has(i.key) ? 'present' : 'absent' : 'not_reanalyzed',
      rationale: decision?.rationale ?? 'Em análise individual; nenhuma decisão de falso positivo ou correção presumida.',
      evidence: decision?.evidence ?? [], branch: decision?.branch ?? '', risk: decision?.risk ?? '',
      url: `http://localhost:9000/project/issues?id=nodeaccess&issues=${encodeURIComponent(i.key)}` }
  })
}
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
export function csv(rows) {
  const keys = ['id', 'key', 'rule', 'type', 'severity', 'domain', 'file', 'baselineLine', 'status', 'observed', 'rationale', 'branch', 'evidence', 'risk']
  const cell = value => {
    let s = Array.isArray(value) ? value.join(' | ') : String(value ?? '')
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s
    return `"${s.replaceAll('"', '""')}"`
  }
  return '\uFEFF' + [keys, ...rows.map(r => keys.map(k => r[k]))].map(row => row.map(cell).join(';')).join('\n') + '\n'
}
export function html(rows) {
  const statuses = [...new Set(rows.map(r => r.status))].sort((a, b) => a.localeCompare(b, 'en'))
  const stateName = { pending: 'Em tratamento', fixed: 'Corrigido no código', context_reviewed: 'Contexto revisado' }
  const observation = { present: 'Presente', absent: 'Ausente', not_reanalyzed: 'Aguardando' }
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NodeAccess — Achados SonarQube</title>
<style>body{font:16px/1.5 system-ui;margin:0;color:#16263a;background:#f5f7fa}main{max-width:1440px;margin:auto;padding:24px}h1{font-size:1.65rem;margin-bottom:8px}.note{max-width:85ch;color:#43546c}.controls{display:flex;gap:16px;flex-wrap:wrap;padding:16px 0}.field{display:grid;gap:4px}input,select{font:inherit;padding:8px;border:1px solid #6e7d90;border-radius:5px;background:white}input{min-width:260px}a{color:#174d91}:focus-visible{outline:3px solid #d36c00;outline-offset:2px}.frame{overflow:auto;background:white;border:1px solid #ccd5e0}table{border-collapse:collapse;width:100%;min-width:740px}th,td{text-align:left;padding:12px;border-bottom:1px solid #dde3eb;vertical-align:top}th{background:#e7edf5}summary{cursor:pointer;font-weight:600}.details{max-width:85ch;overflow-wrap:anywhere}.muted{font-size:.85rem;color:#43546c}.empty{padding:20px}code{font-size:.85rem} @media(max-width:600px){main{padding:12px}.controls{display:grid}input{min-width:0}h1{font-size:1.35rem}}</style>
<main><h1>Achados SonarQube · NodeAccess</h1><p class="note">Inventário de ${rows.length} achados acompanhados, incluindo os 533 originais e novas ocorrências, se houver. Classificação do scanner não comprova vulnerabilidade. A situação de tratamento e a presença na reanálise são informações distintas. Nenhuma regra foi suprimida para melhorar a nota.</p><p><a href="findings.csv" download>Baixar tabela CSV</a> · <a href="findings.json">Dados JSON</a> · <a href="../changes/2026/11/NA-0085-sonarqube/test-results.md">Evidências</a></p>
<div class="controls"><div class="field"><label for="search">Buscar caminho, regra ou decisão</label><input id="search" type="search" placeholder="Ex.: S2189, auditoria, temporário"></div><div class="field"><label for="status">Situação</label><select id="status"><option value="">Todas</option>${statuses.map(s => `<option value="${escape(s)}">${escape(stateName[s] ?? s)}</option>`).join('')}</select></div><div class="field"><label for="domain">Domínio</label><select id="domain"><option value="">Todos</option><option>Backend / shared / agent</option><option>Frontend</option><option>Ferramentas</option></select></div><div class="field"><label for="severity">Severidade</label><select id="severity"><option value="">Todas</option>${['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'].map(s => `<option>${s}</option>`).join('')}</select></div></div>
<p id="count" role="status" aria-live="polite">${rows.length} achados</p><p class="muted">Correção em código e revisão de contexto são decisões diferentes. A presença do ID na reanálise é exibida separadamente; ausência isolada não prova correção.</p>
<div class="frame" tabindex="0" role="region" aria-label="Tabela de achados com rolagem horizontal"><table><thead><tr><th>ID / regra</th><th>Severidade</th><th>Domínio</th><th>Tratamento</th><th>Localização e decisão</th></tr></thead><tbody>${rows.map(r => `<tr data-status="${escape(r.status)}" data-domain="${escape(r.domain)}" data-severity="${escape(r.severity)}"><td><a href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">${escape(r.id)}</a><br><code>${escape(r.rule)}</code></td><td>${escape(r.severity)}<br><span class="muted">${escape(r.type)}</span></td><td>${escape(r.domain)}</td><td>${escape(stateName[r.status] ?? r.status)}<br><span class="muted">Reanálise: ${escape(observation[r.observed] ?? r.observed)}</span></td><td><details><summary>${escape(r.file)}:${escape(r.baselineLine)}</summary><div class="details"><p>${escape(r.rationale)}</p><p><strong>Branch:</strong> ${escape(r.branch || 'em atribuição')}</p><p><strong>Evidência:</strong> ${escape(Array.isArray(r.evidence) ? r.evidence.join(' · ') : r.evidence)}</p><p><strong>Risco:</strong> ${escape(r.risk)}</p><p class="muted">ID Sonar: ${escape(r.key)}</p></div></details></td></tr>`).join('')}</tbody></table></div><p id="empty" class="empty" hidden>Nenhum achado corresponde aos filtros. Limpe a busca ou selecione Todas.</p></main>
<script>const rows=[...document.querySelectorAll('tbody tr')];const fields=['search','status','domain','severity'].map(id=>document.getElementById(id));function filter(){const[q,s,d,v]=fields.map(e=>e.value);let count=0;for(const row of rows){row.hidden=Boolean((q&&!row.textContent.toLocaleLowerCase().includes(q.toLocaleLowerCase()))||(s&&row.dataset.status!==s)||(d&&row.dataset.domain!==d)||(v&&row.dataset.severity!==v));if(!row.hidden)count++}document.getElementById('count').textContent=count+' de '+rows.length+' achados';document.getElementById('empty').hidden=count!==0}fields.forEach(e=>e.addEventListener('input',filter));</script></html>`
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output = 'docs/sonarqube', currentPath] = process.argv.slice(2)
  if (!input) throw new Error('Provide private baseline issues JSON path')
  const issues = JSON.parse(readFileSync(input, 'utf8')).issues
  const decisions = []
  for (const dir of readdirSync('docs/changes/2026/11', { withFileTypes: true })) {
    const file = join('docs/changes/2026/11', dir.name, 'dispositions.json')
    if (dir.isDirectory() && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      const plan = readFileSync(join('docs/changes/2026/11', dir.name, 'plan.md'), 'utf8')
      const branch = plan.match(/^branch: (.+)$/m)?.[1]?.trim() ?? ''
      decisions.push(...(Array.isArray(data) ? data : data.dispositions).map(row => ({ ...row, branch: row.branch || branch })))
    }
  }
  const discoveredPath = join(output, 'discovered-findings.json')
  const previous = existsSync(discoveredPath) ? JSON.parse(readFileSync(discoveredPath, 'utf8')).issues : []
  const current = currentPath ? JSON.parse(readFileSync(currentPath, 'utf8')).issues : null
  const discovered = discoverFindings(issues, current ?? [], previous)
  const rows = catalog(issues, decisions, current, discovered)
  mkdirSync(output, { recursive: true })
  writeFileSync(discoveredPath, JSON.stringify({ schemaVersion: 1, issues: discovered.map(issue => publicIssue(issue)) }, null, 2)+'\n')
  writeFileSync(join(output, 'findings.json'), JSON.stringify({ schemaVersion: 1, baselineCount: issues.length, findings: rows.map(issue => publicIssue(issue)) }, null, 2)+'\n')
  writeFileSync(join(output, 'findings.csv'), csv(rows)); writeFileSync(join(output, 'findings.html'), html(rows))
  console.log(JSON.stringify({ rows: rows.length, reviewed: rows.filter(r => r.status !== 'pending').length }))
}
