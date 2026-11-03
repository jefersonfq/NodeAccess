---
change_id: NA-0100
title: Contratos de sessão SSH interativa MCP
type: chore
status: in-development
created_at: 2026-11-03T16:40:20-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0100-20261103-mcp-interactive
owner: Codex
planner: Codex
risk: low
issue: null
---

# NA-0100 — Testes MCP interativo

## Objetivo e escopo

Ampliar cobertura reproduzível do serviço real `mcp-interactive-ssh.service.ts`: autorização admin/token persistido, isolamento tenant/usuário/token, ACL/perfil/trial, credenciais, bastion, shell, buffers, auditoria e encerramento. Mocks somente nas fronteiras SSH, DB, provider e trial; crypto e streams reais. Não abrir conexões reais, mudar produto, excluir código da cobertura ou executar scanner.

## Aceitação e validação

- Exercitar métodos públicos do serviço real, com assertions observáveis nos limites e efeitos.
- Falhas fecham recursos e não resolvem segredos antes de autorização.
- Testar TTL/limites, eventos, buffer/cursor, contadores, auditoria sanitizada e isolamento.
- Reproduzir testes existentes MCP e build/backend adequado; registrar achados novos separadamente, sem mascarar comportamento defeituoso com mocks.
- Documentos canônicos, commit local em branch própria e revisão independente.

## Risco e recuperação

Somente testes. Usar timers controlados e cleanup de streams/clientes próprios. Nenhuma máquina do usuário ou VPS acessada. Reverter commit remove apenas testes/docs. Uma falha real exige correção em frente separada coordenada com root.

## Aprovação

GO_WITH_RISKS pela autorização do usuário para tratar todas as pendências com branches, testes e simulações; delegação root reservou NA-0100. Não implica merge/publicação ou homologação humana.
