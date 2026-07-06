# PRD Lite - Sessoes ativas / antigo Mapa de acessos

## Status atual
Despriorizado como tela propria.

A rota `/access-map` deve ser removida da navegacao de produto e redirecionar
para `/admin/reports/sessions`. A visao canonica de sessoes deve evoluir no
relatorio administrativo de sessoes para evitar duplicidade de telas, divergencia
de dados e manutencao paralela.

Este PRD permanece apenas como referencia complementar para:
- regras de presenca operacional
- deteccao de acesso concorrente por host
- permissao `canViewLiveSessions`
- indicadores de sessoes abertas usados em outras telas

Qualquer retomada futura deve primeiro fortalecer a fonte de verdade de sessoes
ativas e validar corretamente cenarios com mais de uma sessao no mesmo host.

## Objetivo historico
Este PRD originalmente propunha uma tela operacional chamada `Mapa de acessos`
para identificar, em tempo quase real, quais usuarios estao conectados em quais
hosts, quantas sessoes existem por host e quais hosts estao recebendo acesso
simultaneo.

A direcao atual e nao manter essa tela separada. O objetivo valido passa a ser
fortalecer a visao de sessoes ativas/concorrentes dentro do relatorio de sessoes
existente.

O recurso deve apoiar:
- administradores que precisam acompanhar uso ativo da plataforma
- operadores e usuarios autorizados que precisam atender incidentes sabendo se outra pessoa ja esta conectada ao mesmo host
- suporte e NOC/SOC que precisam enxergar concentracao de acesso sem abrir auditorias individuais

## Decisao de permissao
Nao usar `canManageHosts` como permissao principal deste recurso.

Motivo:
- `canManageHosts` permite cadastrar, editar, mover e organizar hosts
- a visao de sessoes em tempo real e uma capacidade de observabilidade operacional
- misturar as duas permissoes gera privilegio excessivo para usuarios que so precisam enxergar presenca/uso

Permissao recomendada:
- `canViewLiveSessions`

Nome sugerido na UI:
- `Pode visualizar sessoes em tempo real`

Regra inicial:
- `admin` ve tudo do tenant
- usuario com `canViewLiveSessions` ve a tela, respeitando escopo de hosts acessiveis
- usuario sem permissao nao ve menu nem endpoint

Evolucao possivel:
- permissao adicional `canManageLiveSessions` para acoes futuras, como encerrar sessao, solicitar contato, iniciar atendimento ou aprovar controle em cenarios colaborativos

## Escopo funcional
### Tela
Rota sugerida:
- `/admin/live-sessions` para administradores
- ou `/sessions/live` se o produto quiser apresentar como ferramenta operacional fora do menu admin

Nome historico:
- `Mapa de acessos`

Nome recomendado se a capacidade for retomada dentro do relatorio:
- `Sessoes abertas`
- `Sessoes ativas`
- `Acesso concorrente`

### Indicadores principais
Topo da tela:
- sessoes ativas
- hosts em uso agora
- usuarios conectados agora
- sessoes ao vivo ativas
- hosts com acesso concorrente

### Visao por host
Lista agrupada por host com:
- nome do host
- IP/porta
- escopo: pessoal, equipe ou global
- grupo, quando houver
- quantidade de sessoes ativas
- quantidade de usuarios unicos
- protocolos em uso: SSH, RDP, VNC, Telnet, etc.
- badge quando houver acesso concorrente
- duracao da sessao mais antiga
- horario do ultimo acesso iniciado
- usuarios conectados, com nome e e-mail

### Detalhe por host
Ao abrir um host:
- sessoes ativas no host
- usuario
- tipo de acesso
- inicio da sessao
- duracao
- origem quando disponivel:
  - acesso direto
  - bastion
  - agente
  - link proprio
  - JIT
  - sessao ao vivo
- indicador de sessao auditada quando aplicavel

### Visao por usuario
Opcional no primeiro corte, mas recomendada:
- usuario
- quantidade de sessoes ativas
- hosts acessados agora
- maior duracao ativa
- ultima atividade conhecida

## Fora do escopo do MVP
- mostrar tela do terminal/RDP
- mostrar comandos executados
- encerrar sessoes por esta tela
- chat operacional
- notificacoes em tempo real entre usuarios
- replay/auditoria detalhada
- websocket obrigatorio para a primeira versao

## Performance e arquitetura
### Principio
A tela deve usar agregacao leve e cache curto. Nao deve consultar sessoes ativas de forma pesada a cada usuario conectado.

### Endpoint sugerido
`GET /api/v1/sessions/live-overview`

Payload agregado:
- `summary`
- `hosts`
- `users`
- `updatedAt`

Exemplo conceitual:
```json
{
  "summary": {
    "activeSessions": 12,
    "activeHosts": 5,
    "activeUsers": 7,
    "liveSharedSessions": 2,
    "contendedHosts": 3
  },
  "hosts": [
    {
      "hostId": 829,
      "hostName": "TESTE-RDP",
      "ip": "10.0.0.10",
      "scope": "team",
      "groupName": "Infra",
      "activeSessions": 3,
      "activeUsers": 2,
      "protocols": ["rdp"],
      "oldestStartedAt": "2026-06-30T22:10:00.000Z",
      "lastStartedAt": "2026-06-30T22:42:00.000Z",
      "users": [
        { "userId": 1, "name": "Ana", "email": "ana@example.com", "sessions": 2 },
        { "userId": 2, "name": "Bruno", "email": "bruno@example.com", "sessions": 1 }
      ]
    }
  ]
}
```

### Cache
Recomendado:
- cache por tenant com TTL de 3 a 5 segundos
- invalidar ou renovar em background quando possivel
- respeitar visibilidade da aba no frontend

### Frontend
Atualizacao inicial:
- polling a cada 5 ou 10 segundos
- pausar polling quando aba estiver oculta
- botao `Atualizar agora`
- mostrar `Atualizado ha X segundos`

Evolucao posterior:
- WebSocket/SSE para eventos de entrada/saida, mantendo endpoint agregado como fonte de verdade

### Banco e queries
Preferir:
- `sessions` ativas como fonte primaria
- joins simples com `users` e `hosts`
- limite de retorno para hosts e sessoes
- endpoint de detalhe sob demanda quando houver muitos dados

Evitar:
- varrer historico de auditoria para montar a visao em tempo real
- recalcular dashboard completo por usuario a cada polling
- payload com todos os eventos da sessao

## Privacidade e seguranca
Esta tela deve expor apenas metadados operacionais.

Permitido:
- usuario conectado
- host acessado
- protocolo
- duracao
- origem da conexao
- indicacao se ha sessao ao vivo

Nao permitido no MVP:
- comandos
- output do terminal
- tela RDP/VNC
- clipboard
- senha/segredo
- conteudo de arquivos

Auditoria recomendada:
- registrar acesso a tela em telemetria/admin log leve
- registrar acoes futuras, como encerrar sessao ou notificar usuario, quando existirem

## UX recomendada
### Layout
- KPIs compactos no topo
- tabela principal agrupada por host
- filtros laterais ou barra superior:
  - busca por host
  - usuario
  - protocolo
  - grupo
  - somente hosts com concorrencia
- destaque visual para hosts com mais de um usuario conectado

### Estados
- carregando
- sem sessoes ativas
- erro de carregamento
- permissao insuficiente
- dados desatualizados

### Microcopy
Evitar termos de vigilancia excessiva. Preferir linguagem operacional:
- `Usuarios conectados agora`
- `Hosts em uso`
- `Acesso concorrente`
- `Sessao ativa`

## Central de notificacoes futura
Este recurso deve preparar caminho para uma central de notificacoes, mas nao depender dela no MVP.

Notificacoes futuras recomendadas:
- avisar usuario A quando usuario B conectar no mesmo host
- avisar usuario B que ja existe alguem conectado no host antes de abrir uma nova sessao
- avisar operadores quando um host critico receber acesso concorrente
- permitir configurar notificacao por host, grupo ou criticidade

Regra de produto:
- notificacao deve ser informativa, nao bloqueante por padrao
- nao deve expor dados sensiveis
- deve respeitar permissao e escopo do host
- deve ter cooldown para evitar spam em hosts muito acessados

Exemplos:
- `Bruno iniciou uma sessao em TESTE-RDP, que voce tambem esta acessando.`
- `Este host ja possui 2 usuarios conectados.`
- `Host critico com acesso concorrente: DB-PROD-01.`

## Fases sugeridas
### Fase 1 - Dashboard operacional
- permissao `canViewLiveSessions`
- endpoint agregado cacheado
- menu para admin e usuarios autorizados
- KPIs
- lista agrupada por host
- polling leve

### Fase 2 - Detalhes e filtros
- detalhe por host
- filtros por grupo/protocolo/usuario
- ordenacao por quantidade de usuarios, duracao e ultimo acesso
- exportacao simples opcional

### Fase 3 - Notificacoes
- eventos internos de entrada/saida de sessao
- central de notificacoes
- aviso de acesso concorrente ao abrir host
- preferencias de notificacao por usuario

### Fase 4 - Acoes operacionais
- encerrar sessao, se permitido
- solicitar contato
- abrir auditoria da sessao
- vincular atendimento/incidente

## Criterios de aceite do MVP
- usuario admin acessa a tela e ve sessoes ativas do tenant
- usuario com `canViewLiveSessions` acessa a tela sem poder editar hosts
- usuario sem permissao nao ve menu nem endpoint
- tela agrupa sessoes por host
- tela mostra contagem de usuarios por host
- tela mostra usuarios conectados por host
- polling nao ocorre quando aba esta oculta
- endpoint usa cache curto ou estrategia equivalente
- payload nao inclui comando, output, clipboard ou dados sensiveis
- typecheck e testes principais passam

## Riscos e cuidados
- risco de privacidade se a tela parecer vigilancia individual
- risco de performance se virar polling sem cache
- risco de permissao excessiva se reutilizar `canManageHosts`
- risco de confusao com auditoria historica; esta tela e estado atual, nao relatorio de compliance

Mitigacoes:
- permissao dedicada
- metadados apenas
- TTL curto
- limites de payload
- UX operacional e nao punitiva
