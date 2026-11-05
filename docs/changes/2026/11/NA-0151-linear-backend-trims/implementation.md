# NA-0151 — Registro da implementação

## Pedido e objetivo
Corrigir seis S8786 matematicamente não lineares sem mudar contratos de entrada/transporte.

## Implementação
Base02e7521cb, branchfix/NA-0151-20261104-linear-backend-trims. Seisregex corrigidas após GO e baseline; tipos de dois arquivos também corrigidos com autorização da raiz.

## Validação
Baseline227/4 PASS, final247/5 PASS;10080equivalências e12adversariais200k PASS. Typecheckbackend PASS; lintfinal10arquivos0errors/0warnings após assinatura funcional parseKey.

## Recuperação
Reversão isolada, sem migração.

## Pendências
Revisão independente/checkpoint, gates integrados, homologação/publicação e planilha2027 coordenados pela raiz.

## Diário de interações
### 2026-11-04T10:52:44-03:00 — Planejamento
Raiz atribuiu seis IDs e exigiu distinguir limitação prática de complexidade matemática. Criado worktree isolado, fonte instalada S8786 relida e hash registrado; proposta de remoção de repetição sob contratos comprovados e âncora após guard. Nenhum produto alterado; plano enviado para revisão.

### 2026-11-04T11:07:01-03:00 — Implementação e validação
GO_WITH_RISKS recebido após baseline227PASS. Seis substituições mínimas preservam contratos: slugcollapse/trim, fingerprintSHA256/labSchema e primeiro prompt sobguard. Ran:247testes5arquivosPASS;10080equivalências AST contra02e7521 e12inputs200k emchild3sPASS. Inspeção confirmou único provisioner produtivoHTTP valida esquema; nenhuma alteração auth/transporte. Lint inicial revelou10errorslegadoshostkey+10warningscontroller; baselinehostkey via stdin mesmosdeps confirmou10. Raiz autorizou ajustes apenas de tipos nos arquivos afetados; emissãoJScomparada byteidêntica. Primeira modelagem de método parseKey acionou unbound-method, ajustada assinatura de propriedadefunção semmudança runtime. Typecheck PASS. Revisão independente solicitada ao agente frontend; nenhuma decisão do Sonar alterada.

### 2026-11-04T11:10:10-03:00 — Revisões independentes
Raiz reviu seis substituições e reproduziu probe10080+12 PASS_WITH_WARNINGS. Agente frontend leu contratos/tipos e reproduziu247/247 testes e10080+12probe PASS_WITH_WARNINGS; limitações de diferencial finito, DB/provisioner simulados e ausência scanner/transporte registradas. Rerun autor247/5 PASS apósúltimoajuste somente tipo; lint10arquivos0/0. Não inferir achados encerrados até análise integrada.
