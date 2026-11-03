---
change_id: NA-0105
title: Respeitar limites concorrentes e bytes na sessão MCP
type: fix
status: in-development
created_at: 2026-11-03T16:49:00-03:00
base_branch: test/NA-0100-20261103-mcp-interactive
base_sha: 5e881ed9fa6991123ac691144cbcec5c2663bf1d
branch: fix/NA-0105-20261103-mcp-session-limits
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0105 — Admissão e leitura MCP

## Contexto, causa e impacto

Duas regressões reproduzidas na NA-0100: a contagem de sessões ocorre antes dos awaits e ignora aberturas pendentes; com limite 1, dois opens simultâneos conectam. A leitura usa slice em caracteres apesar do contrato maxBytes; “éé” retorna 4 bytes com orçamento 3.

## Escopo e solução

Reservar capacidade de tenant/token sincronamente antes do primeiro await, convertê-la em sessão ativa sem contagem dupla e liberá-la em finally idempotente em todos os erros. Cortar leitura por bytes UTF-8 sem dividir um codepoint, preservando cursor em unidades de string, compatível com o buffer existente. Sem alterar transporte SSH, resize, frontend, autenticação, políticas de auditoria ou permissões.

## Critérios de aceitação

- Regressões falham antes e passam depois.
- Limites de token e tenant incluem pendentes, sem bloquear outro tenant; erro libera vaga e sessão ativa não conta duas vezes.
- Leitura multibyte respeita orçamento e próximo cursor; controles ASCII existentes preservados.
- TTL, close, trial e recursos permanecem sob testes do serviço real; revisão independente antes da integração.

## Riscos e recuperação

Reserva dura até finalizar a tentativa de abertura; não introduz cancelamento do transporte. SSH mantém readyTimeout existente de 15 s. Uma tentativa ainda em curso ocupa uma vaga, inclusive se o cliente abandonar a chamada; isso é conservador e não cria conexões extras. Orçamento menor que um codepoint pode retornar vazio sem avançar cursor; cliente deve solicitar orçamento suficiente (padrão 16k). Reverter somente o commit corretivo restaura comportamento anterior, mantendo testes NA-0100.

## Aprovação

GO_WITH_RISKS. Root reservou NA-0105 e autorizou corrigir os dois defeitos reproduzidos dentro do pedido do usuário de tratar achados/colaterais em branches separadas. Não inclui merge/publicação.

## Evidências e revisão

[Antes: duas falhas reproduzidas](evidence/regressions-before.txt). [Depois: testes e cobertura](evidence/focused-coverage.txt). Revisão independente PASS_WITH_WARNINGS: quota permanece por instância/processo; read usa cursores gerados pelo serviço em unidades UTF16, sem prometer normalização de offsets arbitrários ou reparar buffer previamente truncado. Não houve alteração de transporte/resize.
