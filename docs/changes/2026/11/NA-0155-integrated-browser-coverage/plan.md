---
change_id: NA-0155
title: Cobrir jornadas HA reais nos mapas oficiais sem reduzir gates
type: test
status: draft
created_at: 2026-11-04T12:10:00-03:00
base_branch: fix/NA-0093-sonar-delivery
base_sha: 28a77996deb4c004690e828c4a3a1f6dd292d198
branch: test/NA-0155-20261104-integrated-browser-coverage
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0155 — Jornadas HA na validação integrada

## Contexto e situação anterior
Coleta oficial28a779 passou3565Vitest/531Node/cincoharnesses, mas novo código73.0046%<80. Diagnóstico readonly reproduziu8294unidades/6055hits, déficit581. HA411unidades novas semhit:50script e361template; formatação lint expôs regiões nunca coletadas. HarnessHA existente7cenários passou isoladamente, porém não integra coletor e não acopla CDP. Demais lacunas emdiagnostic.json.

## Problema e objetivo
Exercitar comportamento real HA por testesSSR e browser com APIs simuladas, preservar denominador/fonte/mapas e gates. Cobertura deve resultar da execução, não de marcação de hits ou exclusão. Ganho não prometido antes medição.

## Escopo
Ownership frontend: tools/frontend/ha-playwright-smoke.cjs, testesSSR HighAvailabilityView e fixtures somente de fronteira; docs próprios. Tooling: coletor/orquestração e harnesses audit-input-safety/terminal-highlight-budget emfrente coordenada, sem editar arquivos frontend desta ownership. Nenhuma mudança produto, configuração Vitest/transform/mapas, limiar, baseline Sonar ou serviço real.

## Critérios de aceitação
- [x] HarnessHA acopla attachBrowserCoverage antes da navegação emcada página e encerra capturas emfinally; comportamento standalone opt-in preservado.
- [x] SSR executa SFCsetup/templateoriginais com transformação oficial. MocksaçõesIO/Naive declarados, sem inserir hits ou atribuir page.evaluate como Node.
- [x] Estados licença/empty/loading/error/retry, topologia e gates de operação possuem asserts observáveis; operações perigosas apenas serviçosmockados.
- [x] Ações por controles renderizados verificam argumentos, bloqueios, feedback e liberação emfalha; não testes que simplesmente repetem algoritmo interno.
- [x] Suitesfocais/lint/typecheck e browser real com CDP passam; medição focal compara mapas oficiais idênticos; união integrada e gate final permanecem pendentes, sem alterar o denominador oficial.

## Estratégia técnica
Browser existente: anexar capturaopt-in emcada página real, usando origem loopback do coletor e preservando assertstimeouts/7cenários. Nenhuma promoção/networkreal. SSR: padrão existente createSSRApp/renderToString/importSFCviaVitest; componentesNaive fronteira usam ssrRenderSlot oficial e/ou VNodes legítimos, sem transformaçãoCSRalternativa. Executar load explícito, separar limitação lifecycle coberta pelo browser. Testar sucesso/403/erro/retry/carregamento, PRIMARY/STANDBY/heartbeat/quorum visual, planned switchover bloqueado sem confirmação ou evidência e enviado compayloadcorreto, preflightready/blocked/failure, feedbackeestadofinally. Não forçar refs contraditórias apenas para cobertura; eventos públicos/renderizados quando viável.

## Riscos e mitigações
MapaSSR não coincide automaticamentecomCSR: manterzero semmatch; testesSSR oficiais complementam. Naive mock slots não provam foco/visibilidade: browser real cobre fronteira. HAcrítico: routefulfill+backendloopbackbloqueado, serviçosSSRmockados; sem executar scripts/comandos. Overflowmobilepreexistente documentado NA0154 não será ocultado ou consertado nesta frente. Carga scannerativa: nenhuma cobertura ampla/concorrente na integração; focais somente worktree.

## Matriz de testes e evidências
Baseline relatório28a779 e testeHA isoladoNA0154. NovosVitestSSR com asserts deHTML/controles/payloads e erros; linttest/harness; typecheckfrontend; harnessHA7cenários comCDPprivado, sem atribuirhitantesconversão/mapaoficial. Raiz coordenará união/coverage80/Sonar; testes da orquestração pertencem tooling.

## Baseline
28a77996deb4c004690e828c4a3a1f6dd292d198. Diagnósticoempreportdiagnostic.json; nenhuma fonte editada ao escrever plano. Regra80 preservada e serviçoslegados70/70/60 preservados.

## Rollback ou recuperação
Reverter checkpoint apenas de testes/harness. Sem dados/configuração/produção. Não esconder falhas; timeout e asserções atuais preservados.

## Mudanças de escopo e decisões
Raiz aprovou ownership e pediu revisão backend deste plano antes implementação. SeHA não cobrir déficitglobal, medir e priorizar próximos contratos com evidência; não prometer fechar581automaticamente. Tooling cuidará outros fluxos e instrumentos. Planilha/status iniciativa consolidados pela raiz.

## Aprovação
Decisão: GO_WITH_RISKS de escopo pela raiz; início de implementação condicionado à revisão técnica backend deste plano, conforme coordenação recebida.

## Revisão técnica e ownership confirmados
BackendGO_WITH_RISKS: exigir API não chamada emoperaçõesbloqueadas, payload/feedback naspermitidas e cleanupfinally. Tooling: oitoharnessesobrigatórios;HA/audit-input CDPorigemcompartilhada, highlight-budget VitepróprioNode-only removendo apenasenvCDPnessefilho;outputsprivados eallowlisttrêsnomesexatos; testesmissing/failure/unknown. Nenhumgate/timeoutalterado.
