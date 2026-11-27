---
change_id: NA-0207
title: Extensão 0.1.1 com descrição fiel às funções atuais
type: fix
status: ready-for-tests
created_at: 2026-11-27T14:03:00-03:00
base_branch: release/NA-0206-20261126-vault-production
base_sha: 109add8bf3cdbabdb64ca93d11abaca04b3454f9
branch: fix/NA-0207-20261127-extension-manifest-description
owner: Jeferson Quintana
planner: claude-code
risk: low
issue: null
---

# NA-0207 — Extensão 0.1.1 com descrição fiel às funções atuais

## Contexto e situação anterior

A extensão 0.1.0 (ID `bppcjfeemlkgniinijlcjfihenekaake`) está publicada pelo portal desde NA-0206. O manifesto ainda declara "Busca de itens do cofre NodeAccess (somente metadados).", texto de NA-0183. Desde NA-0195/NA-0203 a extensão também revela/copia segredos e preenche logins na aba atual.

## Problema e objetivo

A descrição exibida em `chrome://extensions` e no diálogo de instalação subestima o que a extensão faz. Objetivo: descrição fiel e um pacote 0.1.1 assinado com a mesma chave, que também exercita o fluxo de atualização.

## Escopo

- `apps/extension/manifest.ts`: nova descrição.
- Teste de manifesto que impede voltar a declarar "somente metadados" e respeita o limite de 132 caracteres do Chrome.
- Pacote local 0.1.1 assinado em pasta separada (`release/vaultnaccess-0.1.1`), sem sobrescrever o 0.1.0.

Fora do escopo: publicar na VPS (usuário escolheu só local), mudar `VAULT_EXTENSION_MIN_VERSION`, permissões, código de preenchimento ou chave/ID.

## Critérios de aceitação

- [x] Descrição cita busca, revelar/copiar e preenchimento com autorização; ≤132 caracteres.
- [x] Testes da extensão, tipos e lint PASS.
- [x] Pacote 0.1.1 gerado com o mesmo ID e verificado por `package*.test.mjs`/verificador independente.
- [ ] `validate:sonar` registrado no SHA do commit. **BLOCKED (ambiente):** Docker inacessível para `jeferson`; ver `docs/sonarqube/validation-NA-0207.md`.

## Estratégia técnica

Mudança de uma string e um teste. Empacotar com `npm run package:extension` usando a configuração privada existente e `VAULTNACCESS_VERSION=0.1.1`.

## Riscos e mitigações

Baixo. Versão maior que 0.1.0 é exigida para atualização; mesma chave preserva o ID. Nenhuma permissão muda, então o Chrome não pede nova aprovação.

## Matriz de testes e evidências

Vitest da extensão, `typecheck:extension`, lint, verificação do pacote, `validate:sonar`. Evidências em `.tmp/NA-0207/`.

## Baseline

SHA `109add8bf`: Vitest da extensão 19 arquivos/372 testes PASS (como `jeferson`; como root faltam navegadores do Playwright). `.tmp/NA-0207/baseline-vitest.log`.

## Rollback ou recuperação

Reverter o commit; o pacote 0.1.0 continua intacto em `release/vaultnaccess` e na VPS.

## Mudanças de escopo e decisões

Nenhuma.

## Aprovação

- Decisão: `GO`
- Usuário pediu "ajustar todos os itens fim a fim" em 2026-11-27, escolhendo VPS só local e push/PR sem merge.
