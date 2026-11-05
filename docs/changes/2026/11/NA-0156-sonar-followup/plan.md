---
change_id: NA-0156
title: Corrigir credenciais de harness e demonstrar contratos CJS e ACME
type: fix
status: planned
created_at: 2026-11-04T12:21:56-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 28a77996deb4c004690e828c4a3a1f6dd292d198
branch: fix/NA-0156-20261104-sonar-followup
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA0156 — Follow-up de análise real

## Contexto e situação anterior
Análise28a779 verificada falhou10novosissues ecoverage. Esta frente cuida S3403restore-env48, S2068trial-live140, S2612challenge-files27/32 e SQ0304S6697helmOllama persistente. Demais regras e cobertura pertencem outrasfrentes. Definições instaladas lidas `/tmp/NA0156-rule-definitions.json`, SHA256d6f6222e30cb5d9b7393009d8cd68d14387322fd4030688f3a7243089c0db775.

## Problema e objetivo
Remover literal de senha desnecessário do teste negativo403 e SecretKubernetes morto no harnessOllama. Preservar guardCJSválido e permissões públicas necessárias a nonceACME, demonstrando justificativa individual em vez de obfuscar condicionais/modos para enganar scanner.

## Escopo
Alterar somente passwordfixture para valor efêmero criptográfico e remover criação de Secret/argumentoexistingSecret no harnessOllama-only. Acrescentar testes reais de entrypoint/import CJS, readerUID distinto ACME e helmtemplate/contextcleanup. Não alterar produto/auth/SSH, chartdeployments, chmod de produção, regra/gate/baseline, ou transição no servidor.

## Critérios de aceitação
- [x] Passwordfixture negativa é aleatória por execução; payload mantém formato/403 esperado e semregistro do valor.
- [x] HarnessOllama rende mesmos workloads sem Secret; api/gateway/frontend/migrations/tests continuam desabilitados, contextoKind e cleanupown mantidos.
- [x] Guardrequire.main===module comprovado por import e CLI reais: import semsideeffect, CLI criaenvprivado e erros mantém código/diagnóstico.
- [x] NonceACME público é legível por UIDdistinto, não gravável; conteúdo é somente nomealeatório. Ancestrais/ownership/symlinks/cleanup permanecem protegidos.
- [x] FP propostos são ocorrência/regra/fonte exatas e nenhuma decisão humana ou ausênciaSonar inferida. Semsuprimirregras nemampliarbaseline.
- [x] Revisão independente concluída, 19 contratos reproduzidos. Análise integrada permanece pendente pela raiz; limitação .mts registrada.

## Estratégia técnica
S2068: randomBytes jáimportado; gerar senha64hex no payload403, semnovohelper desnecessário. SQ0304: URLMySQLunused está emSecret não consumido; chartOllama não usaexistingSecret e aplicações/migrações estãooff. Remover bloco inteiro de criação doSecret e flagexistingSecret; helmtemplateantes/depois comparar documentosworkload reais, não apenas grep. S3403: manter igualdade estritaCJS, provar dois caminhos emsubprocessos. S2612: manter0755/0644 deliberados paraHTTP-reader outroUID, testarFD/write/ancestornegativos; não mudar para0600quequebraria leitura pública. ReplayFPestrito ocorre na frente0157 da raiz, não neste patch.

## Riscos e mitigações
RemoverSecret só é correto com todasasfeaturesconsumidorasoff: demonstrar renderedworkloads equivalentes e testeque detecta referência aSecretremovido. ReaderUIDtesteLinux requerroot para dropuid; registrar skipoutroambiente, semclaimuniversal. MesmoUID/root e substituição concorrente privilegiada permanecem fora da proteçãoFS. Não considerar toda permissãoothers insegura quando dado deliberadamentepúblico; não usar isso para chmod de segredos. Senha403nãousada nãoéexploitreproduzido; geraçãoefêmera éhigieneconcreta.

## Matriz de testes e evidências
Baseline18contratos PASS: restoreenv, challengefiles, trialboundaries. Após: CLI/importchild positivos/negativos, realFSreaderUID, helmcontextfake+templateHelmreal semcluster; testesexistentes. SemDocker/Kind paralelo nemdeployVPS. Executar lint/shellsyntax e revisão da raiz antescheckpoint. Scanner/coverage integrados separados.

## Baseline
28a77996deb4c004690e828c4a3a1f6dd292d198, worktreeisolado para preservar integração. Baseline18PASS em/tmp/na0156-baseline.log. Nenhumproduto editado antesplano. Node24.22.1/dependênciassomenteleitura.

## Rollback ou recuperação
Reverter apenascommitfrente. Nenhumdado/configprod migrado. Restoreharness/ACMEprodsemalteraçãofuncional prevista; fixturesnovas efêmeraslimpas.

## Mudanças de escopo e decisões
Raiz aprovou incluirSQ0304 por dependênciamorta e preservar3FPlegítimos com provas. Não sobrescreverresoluçãohistórica0149; referência explícita na nova resolução. Planilha/homologação/publicação coordenadas pela raiz.

## Aprovação
Decisão: GO_WITH_RISKS de escopo pela raiz; plano aprovado pela raiz antes fontes. Commitlocal apósgatesautorizado; sempush/merge.
