/* Generates audience editions from the reviewed source; no application changes. */
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { marked } = require('marked')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'docs/datasheets')
const edition = 'Setembro 2026 · edição 2'
const intro = `Revisão de documentação e código em 24/09/2026. Inclui alterações locais ainda não necessariamente publicadas. Recursos efetivos dependem da versão instalada, configuração, dependências e autorização. Não constitui homologação de produção nem SLA.`
const css = `
@page { size: A4; }
* { box-sizing: border-box; }
body { margin:0; font-family:Arial,Helvetica,sans-serif; font-size:10pt; line-height:1.35; color:#203149; background:white; }
.cover { min-height:238mm; padding:26mm 0 0; position:relative; }
.cover:before { content:'ACESSO • GOVERNANÇA • PRODUTIVIDADE'; display:block; color:#2563eb; font-size:9pt; font-weight:700; letter-spacing:1.2px; margin-bottom:22mm; }
h1 { font-size:42pt; line-height:1.05; color:#102442; letter-spacing:-1.8px; margin:0 0 10mm; }
.cover p { font-size:12pt; max-width:155mm; margin:0 0 7mm; }
.cover p:first-of-type { color:#2563eb; font-size:18pt; }
.cover:after { content:'NODEACCESS / FICHA DE PRODUTO'; display:block; margin-top:20mm; padding-top:5mm; border-top:3px solid #2563eb; color:#53677f; font-size:9pt; letter-spacing:1px; }
.chapter { break-before:page; }
h2 { font-size:23pt; line-height:1.16; color:#102442; margin:0 0 5mm; border-top:4px solid #2563eb; padding-top:4mm; }
h3 { font-size:12pt; color:#174582; margin:4mm 0 2mm; }
h2,h3 { break-after:avoid; }
p { margin:0 0 2.7mm; }
ul,ol { padding-left:5mm; margin:2mm 0 4mm; }
li { margin-bottom:1mm; }
table { border-collapse:collapse; width:100%; margin:3mm 0 5mm; font-size:9pt; table-layout:fixed; }
th { background:#102442; color:#fff; text-align:left; padding:2.4mm; font-weight:600; }
td { border-bottom:1px solid #dbe3ed; vertical-align:top; padding:1.5mm 2mm; overflow-wrap:anywhere; }
.chapter--requirements table:first-of-type th:first-child { width:28%; }
.chapter--requirements td { padding:1mm 2mm; }
tr:nth-child(even) td { background:#f2f6fb; }
tr { break-inside:avoid; }
thead { display:table-header-group; }
strong { color:#102442; }
code { font-size:8.5pt; color:#28486c; overflow-wrap:anywhere; }
a { color:#2459b0; }
@media screen { body { background:#e8edf5; } main { width:210mm; margin:20px auto; padding:17mm 17mm 18mm; background:white; box-shadow:0 5px 24px #22334420; } .chapter { margin-top:20mm; } }
@media print { p,li { orphans:3; widows:3; } }
`
async function main() {
  const source = await fs.readFile(path.join(root, 'docs/DATASHEET-NodeAccess.md'), 'utf8')
  const chunks = source.split(/(?=^## \d+\. )/m)
  assert.equal(chunks.length, 11, 'Expected eleven customer-facing product chapters')
  const section = number => chunks[number - 1].replace(/^## \d+\. /, '## ')
  const wrap = (title, subtitle, content) => `# NodeAccess\n\n**${title}**\n\n${subtitle}\n\n**${edition}.**\n\n${intro}\n\n${content}`
  const commercial = wrap('Datasheet comercial', 'Acesso centralizado para equipes técnicas, com governança e rastreabilidade.', [
    section(1),
    `## Solução e jornada de adoção\n\nO NodeAccess reúne o trabalho diário no navegador e a administração dos acessos. A proposta pode ser organizada conforme o cenário e os módulos contratados.\n\n| Frente | O que demonstrar | Condição de adoção |\n|---|---|---|\n| Produtividade | Terminal SSH, abas, SFTP, snippets, favoritos e recentes | Destinos e permissões configurados |\n| Governança | MFA, ACL corporativa, credenciais e logs | Política de identidade e inventário |\n| Colaboração | Sessão ao vivo e acesso temporário JIT | Expiração, controle e revogação definidos |\n| Redes privadas | Bastion, agente pessoal/compartilhado ou conector | Rota de rede e escopo autorizado |\n| Atendimento | Jira relacionado a host, ticket e sessão | Integração, permissões e política do tenant |\n| Diagnóstico | Playbooks, evidências e assistência por IA | Módulos, modelo e revisão humana |\n| Continuidade | Operação, backup e HA opcional | Projeto de implantação e ensaio de recuperação |\n\n### Implantação e contratação\n\nImplantação gerenciada pela organização com Docker Compose ou Kubernetes/Helm, conforme projeto. O fluxo SSH web dispensa cliente local; agentes e gateway SSH nativo são opções para necessidades específicas. HA active/passive exige configuração adicional.\n\nO onboarding deve incluir inventário piloto, grupos e ACL, identidade, conexões autorizadas e testes de negação. A expansão depende de medir uso e de homologar integrações e recuperação no ambiente real.\n\n### O que não prometer sem evidência\n\nNão há preço, prazo de implantação, SLA, ROI ou capacidade simultânea garantidos nesta ficha. Os controles de segurança apoiam governança, mas não constituem certificação de conformidade. Serial e AWS Secrets Manager não são entregues como conexão/integração operacional; TACACS+ permanece piloto.\n\n`,
    section(5),
  ].join('\n'))
  const docs = [
    { name:'NodeAccess-Datasheet-2026-09', title:'Datasheet completo', md:source, noCover:true },
    { name:'NodeAccess-Comercial-2026-09', title:'Visão comercial', md:commercial },
    { name:'NodeAccess-Tecnico-Funcional-2026-09', title:'Visão técnica e funcional', md:wrap('Datasheet técnico e funcional', 'Capacidades, fluxos, controles e integrações para avaliação técnica.', [2,3,4,5,6,7,8].map(section).join('\n')) },
    { name:'NodeAccess-Infraestrutura-Operacao-2026-09', title:'Infraestrutura e operação', md:wrap('Datasheet de infraestrutura e operação', 'Arquitetura, dependências, dimensionamento e continuidade para planejar a implantação.', [4,9,10,11].map(section).join('\n')) },
  ]
  await fs.mkdir(out, { recursive:true })
  const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser', headless:true })
  const results = []
  try {
    for (const doc of docs) {
      if (doc.name !== docs[0].name) await fs.writeFile(path.join(out, doc.name + '.md'), doc.md)
      const parts = doc.md.split(/(?=^## )/m)
      const body = parts.map((p,i) => `<section class="${(doc.noCover || i) ? 'chapter' + (p.includes('Requisitos, rede e dimensionamento') ? ' chapter--requirements' : '') : 'cover'}">${marked.parse(p)}</section>`).join('\n')
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NodeAccess — ${doc.title}</title><style>${css}</style></head><body><main>${body}</main></body></html>`
      await fs.writeFile(path.join(out, doc.name + '.html'), html)
      const page = await browser.newPage({ viewport:{ width:1100, height:1200 } })
      const errors=[]; page.on('pageerror', e => errors.push(e.message))
      await page.setContent(html)
      await page.emulateMedia({ media:'print' })
      const structure = await page.evaluate(() => ({
        headings:[...document.querySelectorAll('h2')].map(e=>e.textContent),
        tables:document.querySelectorAll('table').length,
        emptyCells:[...document.querySelectorAll('td')].filter(e=>!e.textContent.trim()).length,
        text:document.body.innerText,
      }))
      assert.equal(structure.emptyCells, 0)
      assert.equal(errors.length, 0)
      assert.ok(structure.headings.length >= 3)
      assert.ok(!/licenciamento|licen[çc]a|licenciad|Limites que devem constar da proposta/i.test(structure.text), 'Customer datasheets must exclude licensing')
      if (doc.noCover) {
        assert.equal(await page.locator('.cover').count(), 0)
        assert.ok(structure.text.trim().startsWith('1. Visão executiva'))
      }
      assert.ok(structure.text.includes('Não') || structure.text.includes('não'))
      assert.ok(!/undefined|\[object Object\]/.test(structure.text))
      const pdf = await page.pdf({ path:path.join(out,doc.name+'.pdf'), format:'A4', printBackground:true, displayHeaderFooter:true,
        margin:{ top:'17mm', bottom:'17mm', left:'17mm', right:'17mm' },
        headerTemplate:`<div style="font:8px Arial;color:#68798e;width:100%;padding:0 17mm;display:flex;justify-content:space-between"><span>NODEACCESS</span><span>${doc.title}</span></div>`,
        footerTemplate:`<div style="font:8px Arial;color:#68798e;width:100%;padding:0 17mm;display:flex;justify-content:space-between"><span>${edition}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      })
      assert.equal(pdf.subarray(0,5).toString(), '%PDF-')
      const pages=(pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length
      assert.ok(pages >= structure.headings.length + (doc.noCover ? 0 : 1))
      await page.emulateMedia({ media:'screen' })
      await fs.mkdir('/tmp/nodeaccess-datasheet-review', {recursive:true})
      await page.screenshot({path:`/tmp/nodeaccess-datasheet-review/${doc.name}-cover.png`})
      if(doc.name===docs[0].name) { await page.locator('.chapter').nth(4).screenshot({path:'/tmp/nodeaccess-datasheet-review/integracoes.png'}) }
      results.push({ file:doc.name+'.pdf', pages, bytes:pdf.length, chapters:structure.headings.length, tables:structure.tables, pageErrors:errors })
      await page.close()
    }
  } finally { await browser.close() }
  await fs.writeFile(path.join(out,'validation.json'),JSON.stringify({ edition:'2026-09-24', validation:'Document generation and HTML structure; not product certification', artifacts:results },null,2)+'\n')
  console.log(JSON.stringify(results,null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
