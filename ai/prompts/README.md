# Prompts NodeAccess

Use estes prompts para reduzir tokens e manter assertividade.

## Uso rapido
- Tarefa geral: `ai/prompts/gpt-base.md`
- Bug backend: `ai/prompts/bug-backend.md`
- Bug terminal: `ai/prompts/bug-terminal.md`
- Feature de hosts: `ai/prompts/feature-hosts.md`
- Feature de auth: `ai/prompts/feature-auth.md`
- Feature baseada em PRD: `ai/prompts/prd-feature.md`
- Bug com PRD/modulo de dominio: `ai/prompts/prd-bug.md`
- Revisao/consolidacao de PRDs: `ai/prompts/prd-review.md`

## Prompts por dominio
- Terminal SSH: `ai/prompts/domains/terminal-ssh.md`
- Bastions: `ai/prompts/domains/bastions.md`
- Port forwardings / Web access: `ai/prompts/domains/port-forwardings.md`
- Snippets / Vault Secrets: `ai/prompts/domains/snippets-secrets.md`
- Agents: `ai/prompts/domains/agents.md`
- Dashboards / Adocao: `ai/prompts/domains/dashboards-adoption.md`
- Auditoria / Compliance: `ai/prompts/domains/audit-compliance.md`
- Auth / Identidade: `ai/prompts/domains/auth-identity.md`

## Regra pratica
- Preencha somente o dominio, o PRD especifico e o objetivo.
- Evite colar historico longo da conversa.
- Prefira anexar o erro/log e pedir investigacao direta.
- Se a tarefa tocar regra de produto, aponte o PRD de dominio via `docs/PRD-map-lite.md`.

## Exemplo curto
```text
Use `ai/prompts/prd-feature.md`.

Dominio: bastions
PRD sugerido: docs/PRD-bastions-lite.md
Objetivo: implementar trust-store de host key para bastions sem alterar a verificacao do host final.
Validar: npm run typecheck -w apps/backend
```
