# Decisions

Registro curto de decisoes de produto e tecnica ja consolidadas.

Formato:
- data
- tema
- decisao
- impacto
- referencias

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

