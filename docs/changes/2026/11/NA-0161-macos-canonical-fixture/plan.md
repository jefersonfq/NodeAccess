---
change_id: NA-0161
title: Canonicalizar fixture temporária no macOS
type: test
status: ready-for-tests
created_at: 2026-11-04T14:22:14-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: b32a6c9c19e6233ddfe024c70c82023f09701685
branch: test/NA-0161-20261104-macos-canonical-fixture
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0161 — Fixture canônica de executáveis

## Contexto e situação anterior

No macOS, os.tmpdir usa /var/folders, alias de /private/var/folders. O resolvedor retorna corretamente o alvo físico; cinco asserções da fixture comparavam o alias textual. Canonicalizar somente a raiz temporária criada pelo teste; preservar o resolvedor e todos os negativos de permissões/symlink. Acrescentado contrato de alias de diretório com rejeição de executável gravável.

## Problema e objetivo

Corrigir comparação de caminhos do teste hospedado macOS.

## Escopo

No macOS, os.tmpdir usa /var/folders, alias de /private/var/folders. O resolvedor retorna corretamente o alvo físico; cinco asserções da fixture comparavam o alias textual. Canonicalizar somente a raiz temporária criada pelo teste; preservar o resolvedor e todos os negativos de permissões/symlink. Acrescentado contrato de alias de diretório com rejeição de executável gravável.

## Critérios de aceitação

- [x] Preservar validação real de caminhos.
- [x] Testar alias positivo e permissão negativa.
- [ ] CI macOS real.

## Estratégia técnica

No macOS, os.tmpdir usa /var/folders, alias de /private/var/folders. O resolvedor retorna corretamente o alvo físico; cinco asserções da fixture comparavam o alias textual. Canonicalizar somente a raiz temporária criada pelo teste; preservar o resolvedor e todos os negativos de permissões/symlink. Acrescentado contrato de alias de diretório com rejeição de executável gravável.

## Riscos e mitigações

Somente fixture/teste; nenhum código de produção alterado.

## Matriz de testes e evidências

Ran:11 testes PASS/2 Windows ignorados em Linux; novo contrato de alias também PASS. macOS/Windows reais aguardam CI, sem inferir aprovação de plataforma.

## Baseline

b32a6c9c19e6233ddfe024c70c82023f09701685

## Rollback ou recuperação

Branch independente e reversão por PR.

## Aprovação

Correção necessária da validação fim a fim autorizada; homologação não presumida.
