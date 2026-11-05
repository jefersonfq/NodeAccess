---
change_id: NA-0128
title: Correção mínima dos advisories de dependências
type: fix
status: ready-for-review
created_at: 2026-11-03T19:03:25.238566-03:00
base_branch: chore/NA-0093-20261103-sonar-integration
base_sha: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d
branch: fix/NA-0128-20261103-dependency-security
owner: Codex
planner: Codex
risk: medium
issue: null
---

# Plano

Investigar falha all-dependencies da PR 59, identificar advisories/fontes primárias e comparação com base. Atualizar somente manifests/lock necessários, sem relaxar política ou aceitar riscos. Major ou refatoração exige análise/opções antes da alteração. Instalação isolada, audit all/runtime, build/typecheck e testes relevantes aos pacotes alterados. Nenhum produto/VPS ou scanner Sonar nesta frente.

## Aprovação e recuperação

GO_WITH_RISKS: correções e commits locais autorizados pelo usuário e delegados pela integração. Reversão de manifests/lock restaura resolução anterior; não compartilhar node_modules durante atualização. Registro de limites e revisão independente antes da integração.

## Escopo ajustado após evidência

A integração autorizou bootstrap npm12.2.1 nos17 jobs npmci (11 workflows), packageManager alinhado sem restringir engines, e patch localizado de TypeDoc via postinstall com guard versão/hash integral. Causa: API matchOne removida no minimatch11; nenhum upstream compatível publicado. Dois COPY do script nos Dockerfiles ativos são necessários ao hook; npm das imagens e arquivo NOTE permanecem intactos. Seis contratos de dependências e cinco do patch/CLI entram na rotina normal de segurança/cobertura. Nenhuma arquitetura de documentação alterada.
