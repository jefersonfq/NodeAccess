# Decisions

Registro curto de decisoes de produto e tecnica ja consolidadas.

Formato:
- data
- tema
- decisao
- impacto
- referencias

## 2026-07-29

### HA de dois nós
- decisao:
  - fechar a versão 2.0.28 com suporte formal a um `PRIMARY` e um `STANDBY`
  - exigir witness/fencing externo para failover emergencial seguro
  - tratar Keepalived como etapa final de publicação da VIP, não como orquestrador
  - manter três ou mais nós fora do escopo suportado desta entrega
- impacto:
  - torna explícitos os limites de segurança e evita promessa de consenso inexistente
  - permite homologar o HA atual sem misturar a futura arquitetura multinó
  - preserva a evolução posterior para migração controlada e failover emergencial
- referencias:
  - `docs/DECISION-ha-two-node-v1.md`
  - `docs/PRD-ha-redundancy-dr-lite.md`
  - `docs/OPERATIONS-ha-dr-runbook-lite.md`

## 2026-04-06

### Port forwarding
- decisao:
  - `localPort` passou a ser porta preferida
  - `assignedLocalPort` passou a ser a porta ativa real no runtime
  - links, `Abrir web` e UX devem usar sempre a porta ativa
- impacto:
  - evita conflito entre usuarios e forwardings simultaneos
  - mantem compatibilidade com templates salvos
- referencias:
  - `docs/PRD-port-forwardings-lite.md`

### Sessao ao vivo
- decisao:
  - owner pode retomar o controle a qualquer momento
  - lease do participante define limite maximo, nao bloqueio ao owner
- impacto:
  - melhora seguranca operacional
  - deixa a governanca da sessao mais clara
- referencias:
  - `docs/PRD-terminal-sharing-lite.md`

### Preferencias de usuario
- decisao:
  - backend virou fonte primaria das preferencias do usuario
  - frontend pode manter cache/local fallback
- impacto:
  - experiencia consistente entre navegadores e maquinas
- referencias:
  - `docs/PRD-platform-adoption-lite.md`
  - `docs/prd-archive/PRD-user-preferences-lite.md`

### Leitura de PRDs
- decisao:
  - fluxo padrao de leitura:
    - `docs/PRD-lite.md`
    - `docs/PRD-map-lite.md`
    - abrir PRD especifico apenas quando necessario
- impacto:
  - reduz tokens
  - reduz ambiguidade
- referencias:
  - `docs/PRD-map-lite.md`

### PRDs secundarios
- decisao:
  - PRDs majoritariamente implementados ou secundarios foram movidos para `docs/prd-archive/`
- impacto:
  - conjunto ativo ficou menor
  - leitura padrao ficou mais objetiva
- referencias:
  - `docs/prd-archive/README.md`

### Saude tecnica do backend
- decisao:
  - saneamento do `typecheck` do backend foi tratado como frente de manutencao sem alterar regra funcional
- impacto:
  - `npm run typecheck -w apps/backend` deve permanecer passando
- referencias:
  - `docs/PRD-lite.md`

### Liveness de sessoes SSH
- decisao:
  - sessoes SSH ativas passam a ter heartbeat persistido em `last_seen_at`
  - consultas criticas de sessoes ativas limpam sessoes stale antes de montar contadores/listas
  - auditorias `RUNNING` de sessoes ja inativas sao reparadas no mesmo fluxo
- impacto:
  - reduz risco de sessoes fantasma em `Inicio`, `Dashboard` e `Sessoes SSH`
  - protege melhor auditoria e limites operacionais quando o websocket nao fecha de forma limpa
- referencias:
  - `apps/backend/prisma/schema.prisma`
  - `apps/backend/src/modules/sessions/session-liveness.ts`
  - `apps/backend/src/modules/ssh/ssh.gateway.ts`

### Vault Secrets e Snippets
- decisao:
  - secrets operacionais devem ser recurso proprio e reutilizavel
  - snippets, macros e outros recursos futuros devem apenas referenciar secrets
  - snippet nao deve armazenar senha/segredo em texto dentro do comando
  - placeholders `{{secret:alias}}` devem ser resolvidos no backend durante o envio ao terminal, nao como payload comum de leitura no frontend
  - stdin relacionado a secret deve ser auditado com placeholder mascarado
  - stdout deve passar por redaction defensivo em memoria com TTL curto apos uso de secret
- impacto:
  - reduz risco de vazamento em auditoria, historico e payloads de API
  - permite uso futuro do mesmo secret por outros recursos alem de snippets
  - UX deve indicar claramente qual secret sera usado sem revelar valor
- referencias:
  - `docs/PRD-vault-secrets-lite.md`
  - `docs/PRD-snippets-lite.md`
