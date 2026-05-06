# PRD Host Associated Links Lite

## Objetivo
Adicionar `Links associados ao host` para acelerar acessos operacionais recorrentes ligados a um host, sem obrigar o usuario a lembrar URLs, portas e caminhos toda vez.

## Motivacao
O NodeAccess ja facilita:
- abrir terminal SSH
- abrir sessao propria por link
- usar `Acessos locais`

Mas ainda falta um atalho para sistemas de apoio comuns no dia a dia, por exemplo:
- painel web interno
- console de aplicacao
- Pulse Admin
- Kibana/Grafana interno
- pagina de healthcheck

Em muitos cenarios, o link e o mesmo para varios hosts e muda apenas o valor do host.

Exemplos:
- `http://{{HOST.IP}}:8080/Pulseadmin`
- `https://{{HOST.IP}}:9090`
- `https://monitoramento.interno/host/{{HOST.NAME}}`
- compatibilidade legada: `http://{{HOST:IP}}:8080/Pulseadmin`

## Criterio de sucesso
- o recurso precisa aumentar a adocao do NodeAccess no uso diario, nao apenas adicionar mais uma tela
- a experiencia de importacao e sync com `1Password` precisa ser altamente estavel e previsivel
- se houver trade-off entre mais automacao e mais confiabilidade, priorizar confiabilidade

## Principios
- deve ser opcional por host
- deve ser simples de entender e usar
- nao deve depender de SSH ativo para abrir
- nao substitui `Acessos locais`
- nao deve permitir esquemas inseguros ou arbitrarios
- resolucao de variaveis deve ser explicita e previsivel

## Relacao com outros recursos
### `Acessos locais`
- `Acessos locais` continuam sendo tunel/control plane tecnico
- `Links associados` sao atalhos de produto/UX
- um link pode apontar:
  - direto para o IP do host
  - para URL interna da empresa
  - futuramente para web access/tunnel ativo, se esse caso fizer sentido

### `Host link`
- `Host link` abre uma nova sessao SSH no NodeAccess
- `Link associado ao host` abre um recurso relacionado ao host

## Escopo inicial recomendado
### Fase 1
- cadastro persistido por host
- titulo
- URL template
- ordem de exibicao
- habilitado/desabilitado
- abertura em nova aba
- resolucao de variaveis basicas do host

### Variaveis iniciais
- `{{HOST.ID}}`
- `{{HOST.NAME}}`
- `{{HOST.IP}}`
- `{{HOST.PORT}}`
- `{{HOST.SSH_USER}}`
- aliases legados aceitos:
  - `{{HOST:ID}}`
  - `{{HOST:NAME}}`
  - `{{HOST:IP}}`
  - `{{HOST:PORT}}`
  - `{{HOST:SSH_USER}}`

### Regras de validacao
- aceitar apenas `http://` e `https://` no primeiro corte
- bloquear `javascript:`, `data:`, `file:` e esquemas desconhecidos
- se houver placeholder desconhecido, nao salvar
- se a URL final ficar invalida, mostrar erro claro

## UX recomendada
### Tela de hosts
- bloco ou menu `Links associados`
- mostrar links mais importantes sem poluir o card
- se houver muitos, usar dropdown ou drawer

### Tela de detalhe/edicao do host
- CRUD completo dos links
- preview da URL resolvida
- ajuda curta sobre placeholders

### Terminal
- opcional futuro:
  - abrir links associados do host ativo na barra superior ou menu contextual

## Modelo sugerido
### `HostAssociatedLink`
- `id`
- `hostId`
- `tenantId`
- `label`
- `urlTemplate`
- `position`
- `enabled`
- `openMode`
- `createdAt`
- `updatedAt`

### `openMode`
- `new_tab`
- `same_tab`

No primeiro corte, `new_tab` e suficiente como default.

## Seguranca
- visibilidade do link deve seguir a visibilidade do host
- sem segredo embutido no template no MVP
- nao resolver secrets no link no primeiro corte
- abertura do link pode gerar `AdminLog`/telemetria futura

## Fora do escopo inicial
- resolver secret em URL
- gerar token efemero automaticamente
- integrar com web access/tunnel ativo
- placeholders vindos de integracoes externas
- placeholders arbitrarios tipo script/template engine

## Implementacao incremental recomendada
### Corte 1
- schema compartilhado
- campos no contrato de host
- parser/validador de placeholders
- PRD e UX base

### Corte 2
- tabela persistida
- CRUD backend
- edicao na tela de host

### Corte 3
- exibicao na listagem de hosts
- abrir/copiar URL resolvida

### Corte 4
- telemetria/auditoria de uso
- integracao com terminal e host ativo

### Proximas melhorias desejadas
- permitir copiar rapidamente o detalhe da falha quando o teste/importacao do `1Password` retornar erro
- facilitar ainda mais o passo a passo para localizar o `op://...` correto no `1Password`

## Riscos
- poluir a tela de hosts com links demais
- usuarios tentarem usar link associado para casos que pedem tunnel
- template solto demais virar fonte de erro ou risco

## Recomendacao
- seguir com placeholders estritos e pequenos
- manter foco em `atalho de produto`, nao em automacao generica
- preservar separacao entre:
  - SSH
  - acessos locais
  - links associados
