# PRD Links Catalog Lite

## Objetivo
Adicionar uma tela consolidada de `Links` para consulta operacional, busca e abertura rapida de links associados, sem substituir o vinculo primario do link com o host.

## Premissa
- o `host` continua sendo a origem funcional do link
- a tela de `Links` e uma visao consolidada, nao a fonte primaria de cadastro
- links podem vir de cadastro manual ou de integracoes

## Motivacao
Depois que o host passa a concentrar varios atalhos operacionais, fica util ter uma visao unica para:
- buscar links por nome, host, grupo ou tag
- abrir rapidamente sem entrar no host
- enxergar origem do link
- identificar links sincronizados x manuais
- auditar uso e qualidade no futuro

## Criterio de sucesso
- a tela de `Links` deve melhorar descoberta e uso recorrente, contribuindo para a adocao do produto no dia a dia
- links vindos de integracao precisam transmitir confiabilidade operacional, principalmente no caso do `1Password`
- a UX deve deixar sempre claro:
  - o que veio manualmente
  - o que veio de integracao
  - quando um sync falhou

## Casos de uso
- operador quer abrir `Pulse Admin` sem lembrar em qual host ficou cadastrado
- admin quer ver quais links vieram do `1Password`
- time quer identificar links quebrados, stale ou duplicados
- usuario quer abrir um link do host ativo sem sair do terminal

## Modelo conceitual
### Origem do link
- `manual`
- `integration`
- `derived`

### Status de sincronizacao
- `manual`
- `synced`
- `stale`
- `error`

### Metadados de origem
- `sourceProvider`
  - exemplo: `onepassword`
- `sourceRef`
  - exemplo: id externo do item/campo
- `sourceLabel`
  - opcional futuro para UX, ex: `1Password`

## UX recomendada
### Tela Links
- listagem consolidada
- busca por:
  - label
  - template/url
  - host
  - origem
  - status
- filtros:
  - manual
  - integracao
  - stale/error
  - host/grupo/tag
- colunas:
  - link
  - host
  - origem
  - status
  - ultima sincronizacao
  - acoes

### Acoes
- abrir link resolvido
- copiar URL resolvida
- ir para host
- duplicar para manual quando origem for integracao

## Integracao com 1Password
### Direcao recomendada
- primeiro corte:
  - links sincronizados como `read-only`
  - usuario pode duplicar para um link manual
- nao editar diretamente no NodeAccess um link sincronizado por integracao

### Comportamento esperado
- quando a integracao estiver ativa, o sistema pode importar templates de link do 1Password
- o link continua vinculado a um host especifico no NodeAccess
- a UI mostra:
  - origem: `1Password`
  - status: `Sincronizado`, `Stale` ou `Erro`
  - host vinculado

## Regras importantes
- visibilidade segue a visibilidade do host
- o host continua sendo a ancora do link
- links de integracao nao devem ser sobrescritos silenciosamente por edicao manual
- evitar conflito entre:
  - link manual local
  - link sincronizado externo

## Fora do escopo inicial
- sync bidirecional com 1Password
- criacao/edicao remota de itens no 1Password
- resolução de secrets dentro da URL
- merge automatico de conflito entre versao local e externa

## Recomendacao de rollout
### Corte 1
- modelagem de origem/status no banco e contrato
- badges de origem na UI atual
- PRD da tela consolidada

### Corte 2
- tela `Links` com busca e filtros
- acao de abrir/copiar/ir para host

### Corte 3
- importacao/sync inicial com `1Password`
- read-only para links sincronizados
- duplicar para manual

### Proximos refinamentos
- permitir copiar o detalhe da falha de teste/importacao do `1Password`
- melhorar o onboarding para encontrar o `op://...` correto e validar o payload antes do merge
