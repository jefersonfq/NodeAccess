# PRD Map Lite

Mapa curto para economizar tokens.

Use assim:
- ler `docs/PRD-lite.md` primeiro
- abrir este arquivo para decidir qual PRD detalhado realmente precisa ser lido
- evitar abrir PRDs de frentes nao relacionadas

## Estrutura recomendada
- `fonte primaria curta`: `docs/PRD-lite.md`
- `mapa de navegacao`: `docs/PRD-map-lite.md`
- `decisoes consolidadas`: `docs/DECISIONS.md`
- `andamento recente`: `docs/WORKLOG-lite.md`
- `PRDs de dominio`: abrir apenas o que toca a tarefa
- `propostas tecnicas`: abrir so quando a tarefa for estrutural ou de infraestrutura

## Estado de referencia
- `ativo`:
  - PRD que ainda guia evolucao funcional ou UX no dia a dia
- `complementar`:
  - PRD util, mas nao precisa ser aberto por padrao
- `tecnico`:
  - proposta estrutural, arquitetura ou execucao tecnica
- `historico controlado`:
  - frente majoritariamente implementada ou de baixo uso atual
  - manter no repo, mas evitar leitura por padrao

## Frentes principais

### Core SSH e sessao
- `docs/prd-archive/PRD-terminal-fullscreen-lite.md`
  - foco: fullscreen do terminal
  - status: implementado com preferencia de usuario
  - referencia: `historico controlado`
- `docs/PRD-terminal-sharing-lite.md`
  - foco: sessao propria e sessao ao vivo
  - status: fase principal implementada; restam refinamentos de UX e evolucoes administrativas
  - referencia: `ativo`
- `docs/PRD-terminal-host-switcher-lite.md`
  - foco: quick switcher de hosts no terminal
  - status: implementado no primeiro corte; restam refinamentos opcionais
  - referencia: `ativo`
- `docs/PRD-terminal-macros-lite.md`
  - foco: macros/snippets no terminal
  - status: frente existente; validar quando a tarefa tocar automacao de comandos
  - referencia: `complementar`
- `docs/PRD-session-policy-lite.md`
  - foco: politicas de sessao
  - status: abrir apenas para regras de encerramento, expiracao e limites
  - referencia: `complementar`

### Hosts, acessos locais e web access
- `docs/PRD-port-forwardings-lite.md`
  - foco: acessos locais, porta preferida x porta ativa, fallback e UX
  - status: runtime com `assignedLocalPort` e UX principal implementados; restam refinamentos contextuais
  - referencia: `ativo`
- `docs/prd-archive/PRD-forwarding-ux-lite.md`
  - foco: UX de forwarding
  - status: complementar; usar quando a tarefa for visual/operacional
  - referencia: `complementar`
- `docs/prd-archive/PRD-web-access-lite.md`
  - foco: abrir servicos web via SSH
  - status: implementado; ler junto com port forwarding quando tocar links e portas
  - referencia: `complementar`
- `docs/prd-archive/PRD-host-key-trust-lite.md`
  - foco: host key changed / trusted host key
  - status: fases 1 e 2 concluidas
  - referencia: `historico controlado`

### Auditoria e compliance
- `docs/PRD-session-audit-lite.md`
  - foco: auditoria SSH
  - status: base implementada; usar para regras funcionais
  - referencia: `ativo`
- `docs/PRD-session-audit-ai-lite.md`
  - foco: IA sobre auditoria
  - status: opcional/futuro
  - referencia: `complementar`
- `docs/PRD-session-audit-licensing-lite.md`
  - foco: licenciamento da auditoria
  - status: abrir so quando a tarefa tocar limites de plano/licenca
  - referencia: `complementar`
- `docs/PRD-session-audit-architecture.md`
  - foco: arquitetura maior de auditoria
  - status: tecnico; evitar por padrao
  - referencia: `tecnico`
- `docs/PRD-session-audit-tech-proposal.md`
  - foco: proposta tecnica de auditoria
  - status: tecnico; abrir apenas em mudancas estruturais
  - referencia: `tecnico`
- `docs/PRD-iso27001-lite.md`
  - foco: aderencia do produto a evidencias e governanca
  - status: backlog inicial definido
  - referencia: `complementar`

### Adocao, preferencia e dashboards
- `docs/PRD-platform-adoption-lite.md`
  - foco: adocao, UX e produtividade
  - status: varias entregas ja implementadas; ainda e referencia principal para evolucoes de UX
  - referencia: `ativo`
- `docs/prd-archive/PRD-user-preferences-lite.md`
  - foco: preferencias do usuario
  - status: parte importante ja persistida; abrir quando a tarefa tocar sincronizacao entre dispositivos
  - referencia: `complementar`
- `docs/PRD-user-dashboard-lite.md`
  - foco: dashboard pessoal
  - status: fases principais implementadas; restam refinamentos analiticos
  - referencia: `ativo`
- `docs/PRD-admin-adoption-dashboard-lite.md`
  - foco: dashboard admin de adocao
  - status: base e drill-down inicial implementados; restam comparativos e filtros mais ricos
  - referencia: `ativo`

### Integracoes e expansoes
- `docs/PRD-jira-session-integration-lite.md`
  - foco: integracao com Jira
  - status: abrir so em tarefas de correlacao com tickets
  - referencia: `complementar`
- `docs/PRD-local-ai-lite.md`
  - foco: IA local opcional
  - status: futuro; ainda orientado por arquitetura
  - referencia: `complementar`
- `docs/PRD-agents-lite.md`
  - foco: agentes
  - status: frente separada; abrir so em tarefas especificas
  - referencia: `complementar`
- `docs/PRD-agents-governance-lite.md`
  - foco: governanca dos agentes
  - status: complementar
  - referencia: `complementar`

### Desempenho e tuning
- `docs/PRD-load-testing-lite.md`
  - foco: estrategia de testes de carga
  - status: plano definido
  - referencia: `complementar`
- `docs/PRD-load-testing-tech-proposal.md`
  - foco: execucao tecnica de testes de carga
  - status: tecnico; abrir so para implementacao
  - referencia: `tecnico`
- `docs/PRD-platform-tuning-lite.md`
  - foco: tuning da plataforma
  - status: abrir apenas para desempenho
  - referencia: `complementar`
- `docs/PRD-platform-tuning-tech-proposal.md`
  - foco: tuning tecnico
  - status: tecnico; evitar por padrao
  - referencia: `tecnico`

### Regras especificas de SSH
- `docs/PRD-ssh-pem-password-lite.md`
  - foco: modo `PEM + password`
  - status: frente avaliada com ajuste de escopo
  - referencia: `complementar`

## Consolidacao de status

### Ja implementado ou majoritariamente implementado
- terminal fullscreen
- compartilhamento de terminal em sessao propria e sessao ao vivo
- quick switcher de hosts no terminal
- port forwarding com porta ativa e fallback
- web access integrado ao conceito de porta ativa
- host key trust
- preferencias persistidas por usuario
- dashboard pessoal
- dashboard admin de adocao no primeiro corte
- saude tecnica: `typecheck` do backend saneado

### Implementado, mas com refinamentos futuros
- sessao ao vivo:
  - retomada do viewer sem novo link
  - refinamentos de UX na transicao de controle
- dashboard pessoal:
  - comparativos com periodo anterior
  - sugestoes mais inteligentes
- dashboard admin:
  - comparativos e filtros mais ricos
- acessos locais:
  - refinamentos contextuais adicionais de UX
- adocao:
  - onboarding curto e telemetria adicional

### Futuro / estrutural
- IA local
- ISO 27001 como suporte a evidencia e governanca
- Jira integration
- agentes e governanca
- load testing e tuning mais profundos

## Sugestao de leitura minima
- para a maior parte das tarefas:
  - `docs/PRD-lite.md`
  - `docs/PRD-map-lite.md`
- abrir um PRD especifico so quando a tarefa cair nestes grupos:
  - terminal compartilhado: `docs/PRD-terminal-sharing-lite.md`
  - forwarding/web: `docs/PRD-port-forwardings-lite.md`
  - UX/adocao: `docs/PRD-platform-adoption-lite.md`
  - dashboard pessoal: `docs/PRD-user-dashboard-lite.md`
  - dashboard admin: `docs/PRD-admin-adoption-dashboard-lite.md`
  - auditoria: `docs/PRD-session-audit-lite.md`

## Candidatos a leitura rara
- `docs/prd-archive/PRD-terminal-fullscreen-lite.md`
- `docs/prd-archive/PRD-host-key-trust-lite.md`
- `docs/prd-archive/PRD-user-preferences-lite.md`
- `docs/prd-archive/PRD-web-access-lite.md`
- `docs/prd-archive/PRD-forwarding-ux-lite.md`

Observacao:
- esses arquivos ainda sao uteis, mas muito do que eles definem ja esta implementado ou consolidado em PRDs mais ativos
- nao recomendo apagar agora; recomendo tratá-los como referencia secundaria

## Recomendacao de uso por tarefa
- tarefa de UX ou produtividade:
  - `docs/PRD-platform-adoption-lite.md`
  - e um PRD de dominio especifico se necessario
- tarefa de terminal compartilhado:
  - `docs/PRD-terminal-sharing-lite.md`
- tarefa de forwarding/web:
  - `docs/PRD-port-forwardings-lite.md`
  - `docs/prd-archive/PRD-web-access-lite.md` se houver link/HTTP
- tarefa de auditoria:
  - `docs/PRD-session-audit-lite.md`
- tarefa de dashboard pessoal:
  - `docs/PRD-user-dashboard-lite.md`
- tarefa de dashboard admin:
  - `docs/PRD-admin-adoption-dashboard-lite.md`
- tarefa tecnica transversal:
  - abrir proposta tecnica apenas se a mudanca realmente for estrutural
