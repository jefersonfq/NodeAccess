# PRD Lite - ISO 27001 Alignment

Versao curta para evolucoes do NodeAccess que aumentam aderencia a ISO/IEC 27001:2022.

## Objetivo
- aumentar a capacidade do produto de apoiar um SGSI
- melhorar evidencia, rastreabilidade e governanca
- fazer isso sem acoplar regra de compliance em excesso no fluxo operacional

## Premissas
- o produto apoia a aderencia; nao substitui o SGSI da organizacao
- a frente deve focar no que o software consegue entregar:
  - evidencias
  - revisao
  - retenção
  - governanca de acesso
  - trilha administrativa
- evitar complexidade que degrade a usabilidade do terminal

## Escopo recomendado
### 1. Retencao e evidencias
- politica configuravel de retencao para:
  - `AuthLog`
  - `AdminLog`
  - `SessionAudit`
- exportacao simples de evidencias
- metadata de export para rastreabilidade

### 2. Revisao de acesso
- visao administrativa para revisar:
  - usuarios ativos
  - grupos
  - hosts globais e de equipe
  - acessos sensiveis
- preparar base para recertificacao periodica

### 3. Trilhas administrativas mais fortes
- registrar mudancas relevantes de configuracao
- reforcar trilha de:
  - integracoes
  - hosts globais
  - permissao de gestao
  - compartilhamento e controle de sessao

### 4. Relatorios e visao de compliance
- filtros e dashboards orientados a evidencia
- sinais de:
  - acessos sensiveis
  - alteracao de host key
  - sessao compartilhada
  - controle concedido
  - usuarios desativados

### 5. Backup e restauracao
- documentar o que precisa ser preservado
- preparar suporte operacional para backup/restore de:
  - banco
  - logs relevantes
  - configuracoes criptografadas

## Fora do escopo
- certificacao ISO 27001 automatica
- GRC completo dentro do produto
- motor complexo de politica corporativa
- substituir ferramenta dedicada de risco/compliance

## Regras de produto
- qualquer camada de compliance deve ser opcional onde fizer sentido
- evidencias nao podem prejudicar performance do terminal
- retenção deve ser configuravel por tenant ou ambiente se possivel
- exportacoes e relatorios devem usar linguagem administrativa, nao tecnica demais
- nada disso deve expor segredos

## Fases sugeridas
### Fase 1
- retenção configuravel
- exportacao basica de logs e auditorias
- pequenos filtros de evidencia no admin

Backlog curto recomendado:
1. exportacao simples de evidencia
- exportar `AdminLog`, `AuthLog` e `SessionAudit` por periodo
- formatos iniciais:
  - JSON
  - CSV quando fizer sentido
- incluir metadata minima:
  - periodo
  - usuario exportador
  - data da exportacao

2. filtros administrativos orientados a evidencia
- facilitar leitura de:
  - `host key changed`
  - sessao compartilhada
  - concessao e revogacao de controle
  - eventos administrativos sensiveis
- objetivo:
  - reduzir tempo para montar evidencia em auditoria interna

3. politica basica de retencao
- configuracao simples por categoria:
  - `AuthLog`
  - `AdminLog`
  - `SessionAudit`
- primeiro corte pode ser global por ambiente
- execucao desacoplada do fluxo critico:
  - job administrativo
  - sem impacto no terminal

Ordem recomendada:
1. filtros de evidencia
2. exportacao basica
3. politica de retencao

Critério de sucesso da fase 1:
- admin consegue localizar eventos relevantes sem consulta manual ao banco
- admin consegue exportar evidencias de um periodo
- produto passa a ter base clara para politica de retencao

### Fase 2
- revisao de acesso
- relatorio de privilegios e acessos sensiveis
- historico administrativo mais rico

### Fase 3
- pacotes de evidencia por periodo
- trilha de mudanca mais completa
- suporte operacional melhor a campanhas de auditoria

## Resultado esperado
- o NodeAccess passa a apoiar melhor auditorias internas e externas
- admins ganham visao mais clara de acesso e evidencia
- o produto se posiciona melhor como controle tecnico dentro de um SGSI
