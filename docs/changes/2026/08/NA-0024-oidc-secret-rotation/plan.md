---
change_id: NA-0024
title: Rotação atômica do client secret OIDC
type: security
status: passed
created_at: 2026-08-11T17:05:00-03:00
base_branch: master
base_sha: e0d1aefae732348226babbc2581cb768d8dbaa42
branch: feature/NA-0024-20260811-oidc-secret-rotation
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0024 — Rotação atômica do client secret OIDC

## Contexto e situação anterior

O secret podia ser substituído pelo formulário geral, junto com issuer, client
ID, políticas e scopes. Isso ampliava o risco de alteração acidental e não
gerava um evento de auditoria específico de rotação.

## Problema e objetivo

Oferecer rotação explícita, atômica e auditável, preservando toda a configuração
não sensível e deixando claro que novos logins usam o valor imediatamente.

## Escopo

- Included: endpoint administrativo dedicado, criptografia, auditoria, contrato
  shared, modal responsivo, feedback e testes.
- Excluded: validar secret sem authorization code, manter dois secrets, alterar
  sessões existentes ou modificar o protocolo OIDC.

## Critérios de aceitação

- [x] Somente o secret muda durante a rotação.
- [x] Secret nunca aparece na resposta, log ou auditoria.
- [x] Endpoint exige administrador e payload válido.
- [x] Interface exige confirmação e informa impacto imediato.
- [x] Loading, erro, sucesso, teclado e mobile são contemplados.
- [x] Testes e typechecks passam.

## Estratégia técnica

Reusar o repositório e a cifra existentes, adicionando método de domínio que lê
a configuração, substitui apenas ciphertext/IV e persiste com o estado enabled
anterior. A UI chama endpoint próprio por meio do serviço existente.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Secret inválido interromper login | Alto | aviso para criar no IdP antes da confirmação | UX sugere teste inexistente |
| Alteração colateral | Alto | merge somente de ciphertext/IV | outro campo muda no teste |
| Vazamento | Crítico | resposta pública e auditoria sem valor | secret aparece em output |
| Duplo envio | Médio | loading e botão desabilitado | chamadas concorrentes pela UI |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Persistência atômica | serviço unitário | campos anteriores preservados |
| Autorização/contrato | rota Fastify | tenant/admin e resposta sanitizada |
| Regressão OIDC | flow tests | troca de código preservada |
| UI/integração | frontend typecheck/build | contrato e template válidos |

## Baseline

Antes, preencher secret e salvar o formulário podia persistir mudanças ainda
em edição nos demais controles, com auditoria genérica de configuração.

## Rollback ou recuperação

Reverter o commit. Não há migration. Em falha operacional, o administrador pode
rotacionar novamente para um secret válido ainda ativo no IdP.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T17:05:00-03:00
