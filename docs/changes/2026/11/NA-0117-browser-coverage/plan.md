---
change_id: NA-0117
title: Cobertura real Chromium com proveniência de Vue e TypeScript
type: test
status: implemented_local
created_at: 2026-11-03T20:40:22+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd
branch: test/NA-0117-20261103-browser-coverage
owner: equipe NodeAccess
planner: Codex
risk: high
---

# NA-0117 — Cobertura browser real

## Contexto e situação anterior
Formatação frontend ampliou linhas alteradas mensuráveis. Cobertura Gitdiff ficou67,88%, enquanto gates legados passaram. Harnesses browser existem, mas só seus processos Node contribuíam para LCOV; módulos Vue realmente executados no Chromium não recebiam crédito.

## Problema e objetivo
Coletar ranges reais CDP e mapear fontes locais verificadas, sem diminuir thresholds, excluir formatação ou atribuir execução de réplicas sintéticas a componentes originais.

## Escopo
Coletor tools/coverage, helper opt-in nos harnesses Playwright, testes de conversão/proveniência/merge e documentação. Nenhum produto, servidor de usuário ou scanner. Fluxos browser extras selecionados pelos gaps e com dados sintéticos/API interceptada.

## Critérios de aceitação
- [x] Ranges reais Chromium convertidos para Vue/TS com mapas e conteúdo validados.
- [x] URL externa, path traversal, fonte divergente, offsets inválidos e mapa ausente falham ou são classificados explicitamente como não fonte; nenhuma atribuição silenciosa.
- [x] Mapas incompatíveis não somam cobertura; fontes não executadas continuam no inventário com zeros.
- [x] Node page.evaluate segue sem crédito Node; browser só recebe crédito de scripts realmente executados com origem verificável.
- [x] Unitários, ensaio Chromium real e revisão independente aprovados; integração mede todos os gates.

## Estratégia técnica
Capturar cobertura JavaScript antes da navegação, preservar código executado e sourcemap, validar origem loopback exata e fontes no inventário por conteúdo. Converter com ast-v8-to-istanbul já fixado. Mesclar somente localizações compatíveis com política conservadora explícita; registrar limitações em summary. Ativação só em harness via env do coletor.

## Riscos e mitigações
Vite browser e Vitest podem gerar mapas diferentes. Nunca somar mapas por IDs; comparar localizações e preservar denominadores. Template sintético reconstruído não prova componente: somente importação do módulo real pode fornecer cobertura. Converter branches negativas para0 seguindo política anterior documentada. Chromium local override possui limitação conhecida de versão; CI usa lock.

## Matriz de testes e evidências
Planned: fixtures de V8/sourcemap com fonte real, rejeições de integridade, merge incompatível/conservador, captura Chromium Vue/TS, harnesses existentes, lint e revisão independente. Medição ampla/scanner serializados pela raiz.

## Baseline
SHA fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd. Testes/LCOV da integração fornecidos pela raiz:3352Vitest PASS, gates services73,15/70,28/64,36 e Gitdiff67,88%. Esses números não são execução desta branch.

## Rollback ou recuperação
Reverter commit do coletor/hooks. Nenhuma migração/configuração de produção. Sem dados reais nos artefatos, saídas privadas em coverage/browser.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou entrega fim a fim e validações reais; raiz reservou NA-0117 e commits locais. Novo mecanismo exige revisão independente antes da integração.
