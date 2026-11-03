---
change_id: NA-0123
title: Testar contratos Vue do Settings e TunnelManager
type: test
status: in_progress
created_at: 2026-11-03T18:09:00-03:00
base_branch: chore/NA-0093-20261103-sonar-final-validation
base_sha: 6af97acad7b1c34de86ba4ed77b600607d96a8c7
branch: test/NA-0123-20261103-settings-tunnel-contracts
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0123 — Contratos Settings e TunnelManager

## Contexto e situação anterior

Instrumentação ampla identificou caminhos reais do Settings e TunnelManager sem testes de componente após saneamento lint.

## Problema e objetivo

Executar SFC real e validar carga isolada plataforma/tenant, salvamento, política de comandos e operações essenciais de túneis.

## Escopo

Somente testes Vue do Settings e TunnelManager e documentos. Produto, denominadores e limiares permanecem fora do escopo.

## Critérios de aceitação

- [x] Estados e ações observáveis testados com componente compilado pelo plugin Vue.
- [x] Falhas de API e recuperação cobertas, sem rede real.
- [x] Lint, tipos e evidências de cobertura observada registrados.

## Estratégia técnica

SFC real compilado pelo plugin Vue existente em SSR e renderToString. Wrapper chama setup original; Settings chama load explicitamente e TunnelManager executa watcher immediate original. Stubs Naive preservam slots. Testes chamam handlers reais de setup e verificam payloads, feedback, HTML SSR e estado resultante. Nenhuma extração/reimplementação do script.

## Riscos e mitigações

SSR não dispara onMounted nem prova CSS/DOM: carga de Settings explicitamente invocada; nenhuma afirmação de foco/layout ou conexão SSH real. Denominador/configuração permanecem intactos.

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Contratos Vue | Vitest componente real | Worktree | test-results.md | Sim |
| Qualidade | ESLint e typecheck | Worktree | test-results.md | Sim |

## Baseline

SHA 6af97acad7b1c34de86ba4ed77b600607d96a8c7. Nenhum gate ou denominador será alterado.

## Rollback ou recuperação

Reverter apenas commit de testes/documentação.

## Mudanças de escopo e decisões

Coordenação separou Diagnostic/TenantLicense (outros agentes) e Settings/TunnelManager (esta frente), sem sobreposição na instrumentação.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário e coordenação (testes reais Vue)
- Aprovado em: 2026-11-03
