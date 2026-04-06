# PRD Lite - User Dashboard

Versao curta para uma visao inicial pessoal do usuario, focada em contexto operacional e adocao.

## Objetivo
- mostrar valor logo ao abrir a plataforma
- reduzir tempo ate a proxima acao util
- transformar uso passado em contexto acionavel
- gerar sinais de telemetria para evolucao de produto

## Por que faz sentido
- favoritos e recentes ajudam na navegacao
- um dashboard pessoal ajuda o usuario a:
  - retomar contexto
  - enxergar o que mais usa
  - perceber valor da ferramenta sem navegar muito
- isso tambem ajuda o produto a medir:
  - o que e mais acessado
  - o que realmente gera uso recorrente

## Escopo recomendado
### 1. Bloco de acesso rapido
- favoritos
- recentes
- ultimas sessoes abertas

### 2. Bloco de atividade pessoal
- maquinas acessadas no ultimo mes
- quantidade de acessos por host
- sessoes abertas no periodo
- sessoes compartilhadas em que participou

### 3. Bloco de produtividade
- acessos locais mais usados
- snippets mais usados
- arquivos/hosts recentes quando fizer sentido

### 4. Bloco de tendencias pessoais
- grafico simples por periodo:
  - acessos por semana
  - hosts unicos acessados
  - sessoes compartilhadas
- foco em leitura rapida, nao BI pesado

## Itens sugeridos para a primeira fase
- favoritos
- recentes
- hosts mais acessados no ultimo mes
- total de sessoes no ultimo mes
- total de acessos locais usados no ultimo mes
- total de snippets disparados no ultimo mes

## Itens que fazem sentido depois
- comparacao com janela anterior
- distribuicao por horario/dia da semana
- retomada de sessao compartilhada se ainda ativa e valida
- sugestoes automaticas:
  - `voce usa muito este host, deseja favoritar?`
  - `snippet X e frequentemente usado neste host`

## Regras de produto
- dashboard pessoal deve usar apenas dados do proprio usuario
- nao misturar isso com dashboard administrativo
- dados precisam ser agregados; evitar expor mais detalhe do que o necessario
- performance deve ser leve; preferir agregacao simples
- quando o modulo nao estiver pronto, `Hosts` continua como entrada principal

## Telemetria e valor de produto
- esse dashboard tambem serve para medir adocao
- sinais uteis:
  - host mais acessado
  - favoritos clicados
  - recentes clicados
  - snippets disparados
  - acessos locais abertos
  - sessao ao vivo iniciada/participada

## Arquitetura recomendada
- modulo separado do dashboard admin
- endpoint proprio de resumo por usuario
- agregacoes simples por periodo
- cache curto no frontend
- preferir leitura de dados ja existentes antes de criar tabela nova

## Fases sugeridas
### Fase 1
- card inicial em nova tela ou na landing do usuario
- favoritos e recentes
- total de sessoes no ultimo mes
- top hosts do usuario no ultimo mes

Status atual:
- primeiro corte implementado com:
  - rota propria de `dashboard` para usuario autenticado
  - favoritos e recentes reaproveitando preferencia local existente
  - resumo pessoal com:
    - sessoes ativas agora
    - total de sessoes no ultimo mes
    - hosts unicos no ultimo mes
    - top hosts do ultimo mes
- o dashboard admin continua separado
- snippets e acessos locais mais usados ficaram para a fase 2

### Fase 2
- acessos locais e snippets mais usados
- graficos leves
- comparacao com periodo anterior

Status atual:
- fase 2 iniciada com telemetria leve e desacoplada:
  - uso de snippet disparado pelo terminal
  - abertura de acesso web via forwarding
  - abertura real de tunnel SSH associado a forwarding salvo
- dashboard pessoal agora pode mostrar:
  - snippets mais usados no ultimo mes
  - acessos locais mais usados no ultimo mes, somando tunnel e acesso web
  - sessoes ao vivo iniciadas e acompanhadas no ultimo mes
  - tendencia simples das ultimas 4 semanas
- comparacao com periodo anterior fica para a proxima iteracao

### Fase 3
- sugestoes e recomendacoes
- retomada contextual de compartilhamento e produtividade

## Resultado esperado
- usuario entende o valor do NodeAccess mais rapido
- a plataforma ganha um ponto de entrada mais util
- o produto coleta sinais melhores para evoluir adocao
