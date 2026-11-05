---
change_id: NA-0126
title: Testar busca e navegação da paleta de comandos
type: test
status: in_progress
created_at: 2026-11-03T18:34:00-03:00
base_branch: chore/NA-0093-20261103-sonar-final-validation
base_sha: 78d4a5c4ce55d23af79412184afec30883a3f6a8
branch: test/NA-0126-20261103-command-palette-contracts
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0126 — Contratos da paleta de comandos

## Contexto e situação anterior

Coleta ampliada identifica callbacks de navegação ainda sem execução. Coordenação autorizou contratos reais sem alterar produto/configuração/gates.

## Problema e objetivo

Validar busca, rotas e escopo de ações apresentadas pela paleta, incluindo falhas de atualização e conexão permitida/negada no frontend.

## Escopo

Teste SFCSSR original e documentação; sem produção, mapas ou denominadores.

## Critérios de aceitação

- [x] Navegação valida destinos explícitos e fechamento, sem mocks do próprio componente.
- [x] Busca, filtragem por perfil/licença e conexão testadas com APIs simuladas.
- [x] Tipos/lint/testes e ganhoLCOV registrados honestamente.

## Estratégia técnica

createSSRApp/renderToString com SFC importado pelo plugin existente. Carga explícita e callbacks reais do setup; HTML de Teleport lido do contextoSSR. Sem extrair/reimplementar script.

## Riscos e mitigações

SSR não prova foco/DOM nem autorização backend. Mocks limitados a stores/IO/serviços; capacidades de protocolos shared reais.

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Busca/navegação/ACLfrontend | VitestSSR | Worktree | test-results.md | Sim |
| Qualidade | ESLint/tipos | Worktree | test-results.md | Sim |

## Baseline

78d4a5c4ce55d23af79412184afec30883a3f6a8. Denominador oficial preservado.

## Rollback ou recuperação

Reverter somente testes/docs.

## Mudanças de escopo e decisões

Coordenação separou a paleta emNA0126 após diagnóstico de ramo inalcançável emSettings; não excluir esse ramo para aprovar gate.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário e coordenação
- Aprovado em: 2026-11-03
