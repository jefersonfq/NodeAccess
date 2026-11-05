---
change_id: NA-0104
title: Contratos de HostService por risco
type: test
status: implemented_local
created_at: 2026-11-03T19:45:48+00:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0104-20261103-host-contracts
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0104 — Contratos de hosts

## Contexto e situação anterior

Coleta abrangente NA-0090 identificou 135 linhas e 32 funções descobertas em HostService, apesar de testes existentes para credenciais, ACL e deleção. A raiz delegou lote específico para fechar o gate legado sem reduzir escopo.

## Problema e objetivo

Exercitar comportamento real de serviço para confiança/histórico de chave SSH, links associados importados do cofre, cache de resumo, verificação de exclusão e detecção de duplicados. Sem modificar produto para facilitar testes.

## Escopo

Novo arquivo de testes focais e documentação da frente. Repositório/Redis/cofre/webhook/eventos são I/O simulado; criptografia e validadores reais. Nenhuma credencial/host do usuário, deploy ou scanner.

## Critérios de aceitação

- [x] Cenários positivos, escopo negado e falhas de I/O relevantes passam.
- [x] Nenhuma alteração de comportamento de produção ou redução de thresholds.
- [x] Medição dirigida e contribuição ao gate agregadas com honestidade.
- [x] Lint, typecheck aplicável e revisão independente realizados; limites registrados.

## Estratégia técnica

Reusar padrões existentes e cobrir caminhos realmente descobertos. Mockar fronteiras de I/O, não o serviço. Assertivas sobre dados e efeitos externos; evitar snapshots de implementação. Medição abrangente fica serializada na raiz.

## Riscos e mitigações

Testes com mocks não provam isolamento SQL/Redis/cofre real. Manter tenant/user explícitos nas expectativas e declarar limites. Não executar ensaios remotos. Preservar testes existentes.

## Matriz de testes e evidências

Executar suite HostService existente mais novos contratos, ESLint focal, medição dirigida do serviço e typecheck backend. Documentar que tsconfig habitual exclui testes; tipos suplementares já revelaram incompatibilidade preexistente Telnet quando Vitest é incluído.

## Baseline

SHA4a77f7139600e70aa612e753418978d9b31b10ae; worktree /tmp/nodeaccess-NA-0104; Node24.21+. node_modules canônico apenas leitura; shared local isolado no workspace.

## Rollback ou recuperação

Reverter somente commit de testes/documentos. Sem migração, runtime ou dados afetados.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou executar todas as pendências de cobertura fim a fim; raiz delegou HostService NA-0104 e commits locais. Não implica homologação nem publicação.
