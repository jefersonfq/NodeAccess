# ISO 27001 Gap Analysis - NodeAccess

Versao curta para avaliar o quanto o produto ajuda na aderencia a ISO/IEC 27001:2022.

## Premissa
- o NodeAccess pode apoiar controles tecnicos e gerar evidencias
- o NodeAccess sozinho nao torna a organizacao `conforme` ou `certificavel`
- ISO 27001 depende de:
  - pessoas
  - processos
  - tecnologia

## O que o NodeAccess ja ajuda a cobrir
### Controle de acesso
- acesso SSH centralizado via browser
- MFA/TOTP obrigatorio
- SSO e base para integracao com Google Workspace
- escopo de hosts `personal`, `team` e `global`
- visibilidade por grupo e por usuario
- desativacao de usuario refletindo em acesso ao sistema

### Rastreabilidade e accountability
- auditoria de sessao SSH
- logs administrativos
- historico de mudanca de host key
- contexto de sessao compartilhada com participantes e janelas de controle
- logs de acoes sensiveis em colaboracao

### Seguranca operacional
- tratamento explicito de `host key changed`
- integracao com cofre por referencia
- segredos fora de claro na API
- expiracao de sessao web com bloqueio de UI
- compartilhamento de sessao com controle temporario e retomada pelo owner

### Governanca tecnica
- administracao centralizada de usuarios, grupos, integracoes e hosts
- reducao de uso de clientes locais dispersos
- trilha operacional mais facil de revisar em incidente ou auditoria

## O que ainda falta no produto para aumentar aderencia
### Evidencia e retencao
- politica configuravel de retencao de logs e auditorias
- exportacao de evidencias para auditoria
- trilha de alteracoes administrativas mais orientada a compliance
- visao de revisao periodica de acesso

### Hardening e resiliencia
- estrategia formal de backup e restore das evidencias do produto
- protecao reforcada de configuracoes e segredos em repouso
- melhoria de observabilidade para falhas de autenticacao e expurgo de sessao
- trilha de mudancas de configuracao critica

### Governanca de acesso
- revisao periodica de privilegios
- expiracao/recertificacao de acessos sensiveis
- aprovacao formal para operacoes sensiveis
- relatorios administrativos para campanhas de revisao

## O que depende mais da organizacao do que do produto
- politica de seguranca da informacao
- inventario e classificacao de ativos
- gestao de riscos
- `Statement of Applicability`
- onboarding e offboarding formais
- gestao de incidentes
- gestao de fornecedores
- treinamento e conscientizacao
- testes de continuidade e disaster recovery

## Recomendacao pratica
### Curto prazo no produto
- retenção/export de logs e auditorias
- revisao periodica de acesso
- relatórios administrativos de evidencia
- backup/restore documentado e testavel

### Curto prazo fora do produto
- mapear controles aplicaveis ao NodeAccess no SGSI
- definir donos de processo e de evidencias
- documentar uso do NodeAccess como controle compensatorio/tecnico

## Conclusao
- o NodeAccess ja ajuda fortemente em controles tecnicos e evidencia operacional
- a plataforma melhora a aderencia a ISO 27001
- mas certificacao exige complemento de processo, politica, risco e operacao organizacional
