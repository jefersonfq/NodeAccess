---
change_id: NA-0120
title: Testar contratos Vue do Dashboard administrativo
type: test
status: in_progress
created_at: 2026-11-03T17:11:23-03:00
base_branch: chore/NA-0093-20261103-sonar-final-validation
base_sha: fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd
branch: test/NA-0120-20261103-dashboard-contracts
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0120 — Contratos Dashboard administrativo

## Contexto e situação anterior

Instrumentação ampla identificou caminhos reais do Dashboard sem testes de componente após saneamento lint.

## Problema e objetivo

Executar SFC real e validar carregamento, erros, navegação acessível, licença, caches e detalhe do usuário.

## Escopo

Somente testes Vue do Dashboard administrativo e documentos. Produto, denominadores e limiares permanecem fora do escopo.

## Critérios de aceitação

- [x] Estados e ações observáveis testados com componente compilado pelo plugin Vue.
- [x] Falhas de API e recuperação cobertas, sem rede real.
- [x] Lint, tipos e evidências de cobertura observada registrados.

## Estratégia técnica

SFC real compilado pelo plugin Vue existente em SSR e renderToString. Wrapper chama setup original e load real; stubs Naive preservam slots e callbacks da tabela. Eventos de componentes são capturados dos controles renderizados. Para cartões nativos, testar handler de teclado real junto às rotas, com browser como evidência complementar. Nenhuma extração/reimplementação do script.

## Riscos e mitigações

SSR não dispara onMounted nem prova CSS/DOM: carga explicitamente invocada; browser NA0118/NA0119 cobre montagem, navegação e geometria. Denominador/configuração permanecem intactos.

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Contratos Vue | Vitest componente real | Worktree | test-results.md | Sim |
| Qualidade | ESLint e typecheck | Worktree | test-results.md | Sim |

## Baseline

SHA fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd. Nenhum gate ou denominador será alterado.

## Rollback ou recuperação

Reverter apenas commit de testes/documentação.

## Mudanças de escopo e decisões

Coordenação separou Diagnostic (outro agente) e Dashboard (esta frente), sem sobreposição na instrumentação.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário e coordenação (testes reais Vue)
- Aprovado em: 2026-11-03
