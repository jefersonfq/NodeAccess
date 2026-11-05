# NA-0124 — Registro da implementação

## Pedido e objetivo

Corrigir corrida no teste de invalidação SFTP preservando asserção forte.

## Implementação

Base SHA20b169ed488ad652adad101c5f41a6779ee1a447, branch fix/NA-0124-20261103-terminal-harness-cache. Produto intacto.

## Validação

Ran:4 testes Node PASS, ESLint3arquivos zero erros/warnings, terminal browser completo PASS no frontend isolado5195.

## Recuperação

Reverter a frente; limpar somente recursos próprios.

## Pendências

Integração e coleta completa com cobertura CDP pela coordenação; índice e planilha também com coordenação.

## Diário de interações

### 2026-11-03T18:15:40-03:00 — Diagnóstico

Root informou falha real: lista inclui consulta /var/log/anaconda da seleção anterior e /var da invalidação, mas assert usa totalglobal+1. Solicitação explícita: contar alvo e sincronizar pendências observáveis, não usar >= nem ampliar timeout. Plano registrado antes da alteração.

### 2026-11-03T18:18:11-03:00 — Correção e validação concluídas

Harness agora aguarda observação do path /var/log/anaconda pós-Tab antes do baseline e conta somente listagens do alvo /var. Helper exige cache previamente aquecido e exatamente uma nova consulta; zero ou duas consultas reprovam. Report inclui contagem por alvo. Nenhum timeout ampliado, nenhuma regra >=, nenhuma alteração de produto.

Ran:4contratos Node reproduzem interleaving válido rejeitado antes e negativo sem invalidação que contagem global aceitaria; também rejeitam duplicação/alvo não aquecido. ESLint3arquivos0warnings e diffcheckPASS. Terminal Playwright completo passou: /var3→4, cursor livre e autocomplete contido desktop/mobile(298/314px), bottomGap10, erros de layout[] e anomaliasCDP[]. Capturas terminal/mobile inspecionadas e copiadas. Banner inicial de orientação preexistente ocupa altura mobile, sem alteração nesta frente.

Revisão raiz PASS_WITH_WARNINGS com4contratos reproduzidos (/tmp/na0124-independent.log). Ensaio usa serviços e WebSocket simulados; não prova transporteSSH real. Não houve mudança de área útil/resize/produto, portanto PTYreal não se aplica. Vite5195 encerrado e browser do ensaio fechou ao concluir. Documentos sincronizados para docs canônico; próximo passo coleta integrada comCDP para confirmar cenário que revelou a corrida.
