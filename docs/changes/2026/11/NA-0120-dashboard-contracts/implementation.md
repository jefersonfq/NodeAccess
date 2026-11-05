# NA-0120 — Registro da implementação

## Pedido e objetivo

Cobrir contratos significativos do Dashboard administrativo com Vue real.

## Implementação

Base SHA fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd. Branch test/NA-0120-20261103-dashboard-contracts. API/router simulados; SFC real.

## Validação

Ran: 15 testes Vitest PASS e lint zero erros/warnings; typecheck final PASS e LCOV final emitido. Não afirmar CSS/DOM ou onMounted a partir de SSR.

## Recuperação

Reverter testes e documentos desta frente.

## Pendências

Integração e nova medição global; coordenação mantém planilha e índice compartilhados.

## Diário de interações

### 2026-11-03T18:05:00-03:00 — Escopo

Coordenação solicitou testes Dashboard enquanto agente backend cobre Diagnostic. Escolhido renderer Vue real em memória para disparar montagem e ações reais sem nova dependência. Nenhuma mudança de produto ou exclusão de cobertura autorizada nesta frente.

### 2026-11-03T18:08:00-03:00 — Contratos SSR reais

Protótipo inicial createRenderer não executava SFC compilado para SSR; ambiente cliente experimental foi removido sem commit e nenhuma configuração compartilhada foi alterada. Coordenação reafirmou preservação do denominador oficial. Implementação final usa createSSRApp/renderToString e componente original, setup/load reais, serviços/router simulados. Renderizações subsequentes preservam estado reativo para verificar abrir/fechar modal e expandir/recolher caches. onMounted não é executado em SSR; não atribuir cobertura desse lifecycle aos testes.

15 casos passam: dados/autenticação/licença/providers, falha de cada API e retry, caches ponderados/top3, seis contratos teclado e rotas com filtros, modal e página do usuário, vazios/sem limite, spinner pendente com promise controlada, cinco fronteiras de licença, filtros ClientUx/hostkey e fallback de nomes/eventos. 7 casos iniciais mediram233/410 statements e138/231 funções no Dashboard, sem alterar instrumentação; coleta final em andamento. Nenhum limiar foi reduzido.

Revisão de abordagem pela coordenação PASS_WITH_WARNINGS: stubs Naive e load explícito não provam montagem/DOM. Revisão independente tooling solicitada. Evidência browser complementar reexecutada nesta interação no checkout NA0119 com harness NA0118:6cenáriosPASS,0pageerrors,390semoverflow,4labels/foco e7ações diagnósticas dentro da tela; log /tmp/NA0119-independent.log. Esse ensaio não ocorreu na NA0120 e não substitui semântica SSR.

### 2026-11-03T18:10:00-03:00 — Checkpoint validado

Ran:15/15Vitest PASS, ESLint zero erros/warnings e vue-tsc frontend PASS. Coleta oficial sem alteração de escopo emitiu236/410 statements e141/231 funções do Dashboard. Parser oficial parseLcov/addedLines sobre diff f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc→HEAD calculou124/210 unidades cobertas:46/106 linhas e78/104 condições;86 unidades permanecem ausentes nesta execução SSR focal. Não inferir ganho incremental da união browser/Vitest nem aprovação global.

Revisão independente tooling PASS_WITH_WARNINGS:15testes reproduzidos em /tmp/na0120-independent.log; mocks Naive renderizam slots mesmo quando modal fechado e, portanto, comprovam props show e transições, não visibilidade/foco reais. Navegação nativa invoca handler real diretamente; browserNA0118 complementa4cartões. Nenhuma mudança produto/configuração/denominador. Cópias documentais desta frente sincronizadas para docs canônico; próximo passo integração e medição global pela coordenação.
