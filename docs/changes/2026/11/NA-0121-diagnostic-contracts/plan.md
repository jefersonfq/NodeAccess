---
change_id: NA-0121
title: Contratos SSR reais da tela de diagnóstico
type: test
status: implemented_local
created_at: 2026-11-03T21:10:05+00:00
base_branch: test/NA-0117-20261103-browser-coverage
base_sha: cc332da586053b88e8a7fce72a1731c672740221
branch: test/NA-0121-20261103-diagnostic-contracts
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0121 — Contratos do diagnóstico Vue

## Contexto e situação anterior
Jornada Chromium cobre diagnóstico real, mas mapas SSR do Vitest e client não são idênticos. Raiz determinou preservar denominadores e adicionar testes significativos do componente compilado.

## Problema e objetivo
Verificar estados renderizados, permissões de ações e requisições de rastreabilidade/IA/Jira/comparação/exportação usando o SFC real no transform existente.

## Escopo
Teste DiagnosticRunDetailView.test.ts e fixture sintética JSON. Sem alterar produto, ambiente Vitest, thresholds ou dependências.

## Critérios de aceitação
- [x] SFC real renderizado via Vue SSR com carregamento real explicitamente invocado.
- [x] Interações pelos handlers de controles renderizados verificam estados e pedidos de API.
- [x] Erros, recuperação, confirmação de anexos e IDs inválidos cobertos.
- [x] Testes, lint, medição dirigida e revisão independente passam; limites declarados.

## Estratégia técnica
Reusar padrão SSR NA-0120: Vue createSSRApp/renderToString e SFC importado pelo plugin existente. Wrapper mantém refs entre renders e chama apenas load inicial; controles Naive stubados em fronteira capturam eventos realmente gerados pelo template. Router, API, clipboard e download simulados. Não reimplementar lógica nem gerar hits.

## Riscos e mitigações
SSR não reproduz DOM, foco ou onMounted; registrar carregamento explícito e usar jornadas Chromium NA-0118/0117 como evidência separada. Stubs não provam internals Naive. Preservar mapas de instrumentação e todos os estados de produto.

## Matriz de testes e evidências
Planned: estados loading/sucesso/erro, recuperação, checksum, origem, comparação, IA, anexosJira, export e navegação; ESLint focal, typecheck frontend e cobertura dirigida. Revisão independente pela raiz/tooling.

## Baseline
Worktree /tmp/nodeaccess-NA-0121; Node24 e dependências canônicas somente leitura. Base inclui NA-0117,119,118 para fonte e jornadas coerentes. Nenhum scanner nesta frente.

## Rollback ou recuperação
Reverter commit de teste/fixture/documentos, sem dados ou runtime afetados.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou entrega e testes fim a fim; raiz reservou NA-0121 explicitamente após checkpoint NA-0117. Commit local autorizado; publicação/integracao pela raiz.
