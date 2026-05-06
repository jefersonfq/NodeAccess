# PRD Terminal Host Switcher Lite

## Objetivo
Adicionar uma forma mais rapida de abrir hosts a partir do terminal, sem obrigar o usuario a voltar para a tela de `Hosts`.

## Problema
Hoje o usuario que esta operando no terminal precisa sair do fluxo para localizar e abrir outro host. Isso aumenta atrito, principalmente para tecnicos que:
- alternam rapido entre varios hosts
- usam favoritos e recentes
- querem manter a mao no teclado

## Hipotese
Um `quick switcher` de hosts dentro do terminal melhora adocao e produtividade, porque reduz navegacao lateral e aproxima a experiencia de ferramentas desktop mais usadas pelo publico tecnico.

## Principios
- nao quebrar o fluxo atual de terminal
- reaproveitar componentes e servicos existentes
- manter entrada principal por atalho e botao explicito
- hover deve ser opcional, nunca o unico caminho
- preferencia por usuario

## Escopo
### Em escopo
- quick picker de hosts dentro do terminal
- abertura de host em nova sessao/aba do terminal
- busca por nome e IP
- favoritos e recentes em destaque
- preferencia do usuario para habilitar entrada rapida

### Fora de escopo inicial
- hover complexo com varios menus contextuais
- fuzzy search avancada no backend
- abrir host em split automaticamente
- automacao de comandos ao abrir host

## UX recomendada
### Fase 1
- atalho configuravel para abrir o `Host Quick Switcher`
- botao pequeno no topo do terminal
- lista inicial com:
  - favoritos
  - recentes
  - hosts visiveis
- `Enter` abre nova sessao no terminal

### Fase 2
- preferencia por usuario:
  - habilitado
  - desabilitado
  - atalho configuravel

### Fase 3
- `hover trigger` opcional no canto superior
- nunca habilitado por padrao
- pensado como acelerador extra, nao como UX base

## Regras de comportamento
- deve respeitar visibilidade e acesso ja existentes
- deve abrir o host no terminal usando o fluxo normal do produto
- deve reaproveitar favoritos e recentes ja existentes
- se o usuario nao tiver hosts visiveis, mostrar estado vazio claro

## Reaproveitamento recomendado
- quick picker de snippets como referencia visual
- favoritos e recentes de hosts ja existentes
- store de terminais ja existente
- abertura normal de nova aba no terminal

## Entregaveis esperados
### Fase 1
- quick picker de hosts no terminal
- atalho inicial seguro
- botao visivel no topo do terminal

### Fase 2
- preferencia por usuario para habilitar e escolher atalho

### Fase 3
- hover opcional no canto superior com entrada rapida

## Medidas de sucesso
- menor necessidade de voltar para `Hosts`
- mais reuso do terminal como ponto central de operacao
- aumento do uso de favoritos e recentes
- menor tempo para abrir um segundo ou terceiro host

## Proximo passo recomendado
Implementar primeiro:
1. botao no topo do terminal
2. quick picker simples
3. atalho configuravel por usuario
