---
change_id: NA-0021
title: Endurecimento da entrada de autenticação
type: security
status: passed
created_at: 2026-08-11T15:45:00-03:00
base_branch: master
base_sha: b0ac70e9c382a63e77b9067cf29ae2c3f4fec4ed
branch: security/NA-0021-20260811-auth-entry-hardening
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0021 — Endurecimento da entrada de autenticação

## Contexto e situação anterior

A entrada já possuía limites por ação, IP, tenant e identidade, mensagens
públicas uniformes e redaction básico. As referências Redis usavam SHA-256 sem
chave, falhas ao definir TTL não eram verificadas e Google/logout não aplicavam
a dimensão por credencial.

## Problema e objetivo

Reduzir ataques distribuídos e exposição indireta de identificadores, impedir
bloqueios permanentes causados por contador sem TTL e ampliar a sanitização de
tokens, códigos e claims em logs.

## Escopo

- Included:
  - HMAC para referências opacas de rate limit;
  - validação atômica dos resultados de incremento e expiração;
  - dimensão de identidade para Google e logout;
  - redaction de variantes OAuth em query, fragmento, body e erros HTTP;
  - testes de limites, controllers e logger;
  - revisão do fluxo de descoberta de tenant.
- Excluded:
  - remover o fluxo email-first;
  - CAPTCHA ou integração com WAF externo;
  - alterar limites configurados pela instalação;
  - armazenar tokens ou identidades em métricas.

## Critérios de aceitação

- [x] Nenhum valor bruto de IP, tenant ou identidade aparece nas chaves Redis.
- [x] Referências não podem ser reproduzidas sem o segredo da instalação.
- [x] Falha de transação ou TTL bloqueia a operação de forma segura.
- [x] Google usa IP, tenant e credencial; logout usa IP e refresh token.
- [x] Todas as dimensões retornam a mesma mensagem pública 429.
- [x] Query, fragmento, body, claims e erros aninhados são sanitizados.
- [x] Descoberta continua condicionada à política do tenant e rate limit.
- [x] Testes direcionados, typecheck e diff check passam.

## Estratégia técnica

Manter o serviço único de rate limit e trocar apenas a derivação de chaves por
HMAC-SHA256 com separação de domínio. Continuar passando valores ao serviço,
que os transforma antes de qualquer persistência. Expandir caminhos de
redaction sem registrar payloads adicionais.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Token aparecer em logs | Crítico | redaction em URL/body/erro e testes de conteúdo | segredo presente no output |
| Contador sem TTL bloquear permanentemente | Alto | validar retorno de `EXPIRE` | operação prossegue com TTL inválido |
| Ataque distribuído por credencial | Alto | dimensão HMAC de identidade | Google/logout somente limitados por IP |
| Enumeração via email-first | Médio | policy opt-out + IP/identidade | tenant privado retornado |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| HMAC e dimensões | unitário rate limit | chaves opacas e limites independentes |
| TTL/Redis | unitário de falha | fail-closed em transação/expiração |
| Rotas | controller unitário | Google/logout antes do serviço |
| Logs | logger unitário | segredos ausentes no output |
| Regressão | auth suites + typecheck | resultados registrados |

## Baseline

Antes da mudança, um dump de chaves permitia tentativa de dicionário sobre
e-mails e tenants, e um erro parcial do Redis podia deixar contador sem prazo.

## Rollback ou recuperação

Reverter o commit da NA-0021. Não há migration. A troca do segredo ou rollback
apenas reinicia efetivamente as janelas de rate limit, sem afetar sessões.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T15:45:00-03:00

