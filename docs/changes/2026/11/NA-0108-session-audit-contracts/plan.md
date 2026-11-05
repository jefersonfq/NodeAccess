---
change_id: NA-0108
title: Contratos públicos de auditoria de sessão
type: chore
status: in-development
created_at: 2026-11-03T16:59:18-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0108-20261103-session-audit-contracts
owner: Codex
planner: Codex
risk: low
issue: null
---

# NA-0108 — SessionAuditService

## Objetivo e escopo

Cobrir contratos públicos do serviço real de auditoria: listagem/metadata, autorização antes de storage, download/preview/comandos, resumos/jobs/artifacts, vínculo JIRA, contexto compartilhado e estatísticas por participante. Reconstrução e exportação reais; mocks apenas de repositórios/storage/providers. Não duplicar testes existentes dos parsers nem alterar produto.

## Critérios de aceitação

- Metadados públicos não expõem campos internos; tenant é passado aos repositórios antes de acessar chunks.
- Eventos, comandos e transcrições usam JSONL sintético, sem dados ou gravações do usuário.
- Erros de sessão/retention/provider são observáveis; jobs/artifacts/IA/JIRA preservam escopo e estados.
- Participantes, leases e estatísticas conferidos por valores reais reconstruídos.
- Testes focados e suite de auditoria existentes, cobertura medida, revisão independente e docs canônicos.

## Riscos e recuperação

Somente testes. Não acessa DB/SSH/JIRA reais nem executa scanner. Mocks não comprovam isolamento SQL ou transação real; opt-ins existentes serão registrados se skipped. Reverter commit remove apenas testes/docs. Defeitos encontrados serão reportados sem expansão de produto nesta frente.

## Aprovação

GO_WITH_RISKS conforme autorização do usuário para testes/simulações e delegação root reservando NA-0108. Não inclui publicação/merge.
