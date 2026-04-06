# PRD Lite - Admin Adoption Dashboard

Versao curta para acompanhar adocao real da plataforma no painel administrativo.

## Objetivo
- mostrar quais usuarios realmente usam a plataforma
- destacar hosts, telas e recursos que mais geram uso
- dar base simples para priorizacao de produto e onboarding
- evitar BI pesado no primeiro corte

## Por que faz sentido
- o dashboard admin atual mostra operacao, mas nao explica bem adocao
- a empresa precisa enxergar:
  - quem usa
  - o que usa
  - por onde navega
  - quais recursos realmente geram retorno

## Escopo recomendado
### 1. Usuarios mais ativos
- usuarios com mais sessoes no periodo
- ultima atividade
- host mais acessado por usuario

### 2. Hosts mais acessados
- total de sessoes por host
- quantidade de usuarios unicos por host

### 3. Telas mais acessadas
- leitura simples de navegacao
- foco em `Início`, `Hosts`, `Terminal`, `Snippets`, `Acessos locais` e telas admin

### 4. Recursos mais utilizados
- sessoes SSH
- snippets
- acessos locais
- sessoes ao vivo

### 5. Usuarios vs recursos
- quadro leve por usuario com:
  - sessoes
  - snippets
  - acessos locais
  - sessoes ao vivo

## Itens que fazem sentido depois
- drill-down do usuario:
  - ultimos 50 acessos com data, hora e host
  - hosts mais acessados
  - recursos mais usados
- drill-down do host
- comparacao com periodo anterior
- filtros por grupo/equipe
- exportacao simples

## Regras de produto
- dashboard de adocao admin deve ficar separado do dashboard pessoal
- agregacoes por periodo devem priorizar leitura rapida
- sem nova tabela no primeiro corte; preferir `sessions`, `shared_sessions` e `admin_logs`
- telemetria de tela deve ser leve e desacoplada

## Arquitetura recomendada
- expandir o modulo admin `dashboard`
- telemetria de tela em `admin_logs`
- leitura por janela de 30 dias no primeiro corte
- componentes visuais reaproveitados, mas logica de dados propria

## Fases sugeridas
### Fase 1
- usuarios mais ativos
- hosts mais acessados
- telas mais acessadas
- recursos mais utilizados
- usuarios vs recursos

### Fase 2
- drill-down por usuario
- ultimos 50 acessos
- comparacao com periodo anterior

Status atual:
- fase 2 iniciada com:
  - visao dedicada por usuario no admin
  - filtro simples por periodo `7/30/90 dias`
  - reutilizacao do mesmo endpoint de dashboard com janela configuravel
  - proximo passo sugerido:
    - comparacao com periodo anterior no detalhe do usuario

### Fase 3
- filtros por grupo
- exportacao e insights de adocao

## Status atual
- fase 1 iniciada com:
  - PRD proprio
  - telemetria leve de telas via `admin_logs`
  - dashboard admin com secoes de adocao:
    - usuarios mais ativos
    - hosts mais acessados
    - telas mais acessadas
    - recursos mais utilizados
    - usuarios vs recursos
  - drill-down inicial por usuario dentro do proprio dashboard:
    - hosts mais acessados
    - ultimos 50 acessos com data, hora e host

## Resultado esperado
- facilitar leitura executiva e operacional da adocao
- dar evidencias mais claras para priorizacao de onboarding e produto
- mostrar valor real da plataforma dentro do tenant
