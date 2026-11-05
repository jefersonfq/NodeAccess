---
change_id: NA-0135
title: Uniformizar Chromium instalado no coletor de navegador
type: fix
status: in-development
created_at: 2026-11-03T22:56:58+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: b76faaec6031f3ebed1372a65dcede08f930cde0
branch: fix/NA-0135-20261103-browser-executable
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0135 — Chromium consistente no coletor

## Contexto e situação anterior

Workflow instala navegador Playwright, mas coletor só encaminha caminho quando há override. Terminal/platform então usam /usr/bin/chromium-browser, que não é garantido no runner GitHub. O job falhou antes de LCOV, mas o log bruto foi apagado; essa causa específica é uma inferência compatível, não confirmação retroativa.

## Problema e objetivo

Escolher executável gerenciado pelo Playwright quando não há override e propagá-lo uniformemente aos cinco filhos.

## Escopo

tools/coverage/browser.mjs e testes/documentação. Nenhum componente, timeout, gate, mapa de cobertura ou baseline alterado.

## Critérios de aceitação

- [x] Override explícito preservado e usado em ambas as variáveis.
- [x] Sem override, chromium.executablePath() propagado para todos os cinco harnesses.
- [x] CHROMIUM_PATH externo conflitante não substitui escolha.
- [x] Falhas de navegador continuam fechadas, sem fallback silencioso.
- [x] Testes e ensaio real com caminho local documentado; revisão independente.

## Estratégia técnica

Resolução única no orquestrador; usar API do pacote instalado, não PATH/binário de sistema. As cinco ferramentas continuam iguais.

## Riscos e mitigações

Navegador gerenciado precisa estar instalado; workflow já executa instalação. WSL local não tem versão1248, portanto ensaio real usará1234 explícito, sem alegar prova do runner remoto. Nenhum download ou binário de sistema será alterado.

## Matriz de testes e evidências

Planned: regressão de propagação antes/depois, override/default/conflito/negativo, contratos de cleanup e cinco harnesses reais.

## Baseline

b76faaec6031f3ebed1372a65dcede08f930cde0; versão local Playwright requer Chromium1248 não instalado, systembin existe. Evidência GitHub de ausência separada do ensaio WSL.

## Rollback ou recuperação

Reverter resolução e propagação isoladas; sem dados/configuração de produto.

## Aprovação

Decisão: GO_WITH_RISKS. Raiz autorizou correção pontual e ensaio local sem enfraquecer gates.
