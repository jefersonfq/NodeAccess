# NA-0170 — Registro da implementação

## Pedido e objetivo
Integrar e usar OWASP ZAP e StrykerJS, conforme autorização expressa do usuário.

## Implementação
Base745253d1edb522db79aaa44fd96608ce434a2774, branchsecurity/NA-0170-20261105-zap-stryker em /tmp/nodeaccess-NA-0170 para preservar alterações alheias. Plano aprovado pelo escopo solicitado; ferramentas locais/CI, sem produção.

## Validação
Ran: leitura mínima de contexto, master remoto verificado, infraestrutura/versões verificadas e fontes oficiais consultadas. Planned: ZAP/Stryker reais, contratos, lint, auditoria, CI e revisão independente. Nenhuma execução das duas ferramentas declarada ainda.

## Recuperação
Base acima; reversão por PR e limpeza apenas de recursos próprios. Sem alteração de schema.

## Pendências
Implementação e validações do plano. Homologação operacional de produção fora do escopo.

## Diário de interações

### 2026-11-05T10:08:33.010371-03:00 — Autorização e abertura
Usuário pediu instalar/integrar e usar ambas as sugestões. Definido piloto executável e repetível em ambiente descartável, limites e relatórios; sem expansão para varredura produtiva. Documentos em docs canônico, worktree separado por alterações preexistentes. Próximo passo: integrar ferramentas e executar baselines reais.

### 2026-11-05T10:17:33.968203-03:00 — Baseline de mutação e dependências

Ran: Stryker10.1.1/Vitest4.1.12,74 mutantes,baseline75.68% reprovou80%; auth82.93% eMCP66.67%. Testes reforçados para lacunas reais sem mudar produto; segunda medição95.95%,71detectados/3sobreviventes/0semcobertura. Medição final após revisão do runner ainda pendente. Evidência baseline preservada.

Auditoria das novas devDependencies identificou qs/typed-rest-client com2Moderate; runtime0. Correção necessária: override limitado ao qs do typed-rest-client para6.17.1, mantendo cliente2.3.1. AdvisoryGHSA-6pq8-jhm2-2vcw consultada; npmmetadata versão verificada. Ran: auditoria final runtime/all0,2testes decompatibilidade e rejeição de crash emquerycomma PASS. Sem relaxamento do gate ou mudança em dependênciasruntime.

ZAP oficial fixado por digest em preparação; scanner real ainda sem resultado declarado. Workflow dedicado preparado, artefatosCI somente summaries sanitizados. Próximo passo: concluir execuções/revisão e conferir limitações/achados.

### 2026-11-05T10:32:04.383946-03:00 — Evidências, revisão e planejamento vivo

Ran: mutação final97.2973%,72/74,zero semcobertura/timeouts/erros/ignorados; auth100%,MCP93.94%. Dois guardsredundantes permanecem no denominador, equivalência verificada independentemente. Revisor reproduziu descendente órfão apósparentexit0; executor corrigido e contrato deprocesso reexecutado. Novo teste opt-in executaStrykerreal na coleta de cobertura; prova comUUID e fingerprint evita reutilização de relatório antigo.

ZAP primeira rodada reprovou readinessAPI; cleanup completo. Hipótese validada no padrãoexistente: diretório de auditoria emlabnonroot exige configuração temporária. Laboratório corrigido, segunda rodada pendente. Validadores deversão/cenários/HTTP e cancelamento em endurecimento; não declarar scanner aprovado.

Planilha canônica META-050 atualizada com estadoParcial/LOCAL_WIP e limites, revisão adicionada na abaRevisões; demais entradasZIP e Original2027 preservadas. Índices documentais atualizados nas duas pastas. CoberturaPythonextra e Strykerreal em integração para manter gateSonar, sem excluirfontes ou relaxarthreshold.

### 2026-11-05T10:40:43.996307-03:00 — Integração de evidências e bloqueios do piloto

Ran: coletor com Strykerreal e PythonZAP sob UUID compartilhado, hashes de fontes/relatórios e limpezaverificada. Revisor identificou que prova resumida de mutação ainda permitia metadados sem raw/fingerprint; endurecimento em andamento, semaprovaçãofinal. Testes de configuraçãoSonar6PASS com ambosXML; nenhuma exclusão de cobertura adicionada.

ZAP: safe mode negou APIcore.sendRequest; substituição por tráfegoHTTPSnormal atravésproxy comCAefêmera validada, mantendo modo seguro. Rodada posterior bloqueou em migrations do banco descartável; diagnóstico privado em andamento. Contratos/simulações não representam aprovação do scannerreal. Todas rodadas encerradas registraramcleanupcomplete; sem uso de produção.

Auditoria dependênciasruntime/all0. Compatibilidade inicialmente reprovou TypeDoc porque instalaçãoignore-scripts não aplicou postinstall já existente; postinstall do projeto executado,11contratos PASS, sem mudança de fonte para esseproblema. Lock comparado combase: nenhuma versão de pacote existente alterada; novas entradas apenas desenvolvimento. Próximo gate: ZAPreal+revisão, depoisSonarlocal no candidato estável.

### 2026-11-05T10:50:20.095750-03:00 — Primeiro ZAP completo e decisão de CSP

Ran: ZAP2.17.0 concluiu12fluxosHTTP/18mensagens/62regraspassivas comcleanupcomplete. Encontrou1Medium(CSPstyleunsafe-inline10055-6),2Low(versãodoServidor/IPprivadobundle) e4Info. Gatefalhou corretamente, semFP/aceiteautomático. Usuário informado e perguntado sobre corrigirCSPemfrenteseparada ou manterbloqueioregistrado; resposta pendente, nenhuma alteraçãoprodutiva deCSP iniciada. ÚltimoZAPnoexecutorfinalcomTCP/processcleanup emexecução; Sonarlocal iniciado comfontescongeladas.

### 2026-11-05T10:52:36.416316-03:00 — Execução local final das ferramentas

Ran: ZAP final93s,12cenários/18mensagens/62regras,1Medium/2Low/4Info,cleanupcomplete e nenhumcontainer próprio remanescente. Exit1 exclusivamente peloMediumCSP, semerrodeexecução. Gateintacto. Revisão funcionalindependente PASS_WITH_WARNINGS; aprovação global não declarada. README atualizado nasduaspastas com ferramentas efetivamenteinstaladas/escopo, guia e evidências. Sonarlocal emexecução. DecisãoCSP do usuário ainda pendente.

### 2026-11-05T11:04:22.944133-03:00 — CSP autorizada e falha real na validação

Usuário autorizou corrigir CSP em frente separada com testes de interface: NA-0171 criada sobre master745253d1e. NA-0170 permanece LOCAL_WIP. Ran: validate:sonar executou 802 testes Node aprovados, zero falhas e sete skips; browser frontend/table aprovados, terminal falhou na asserção da ordem das listagens SFTP (segunda listagem / em vez de /var). Scanner não executado nessa rodada; cobertura Chromium não produzida. Causa sob investigação, sem relaxar gates.

### 2026-11-05T11:09:17.964193-03:00 — Correção necessária do teste de navegador

Ran: typecheck completo aprovado. Investigação independente confirmou pressuposição frágil na base; mecanismo exato da consulta intermediária não foi inferido sem instrumentação. Alterados somente terminal-sftp-assertions.cjs/test.mjs e terminal-experience-playwright.cjs para sequência ordenada, REST zero e diagnóstico por prefixo/socket; invalidação exata e stress preservados. Sete contratos aprovados pelo implementador e pelo revisor independente. Navegador real em repetição; ainda sem aprovação Sonar.

### 2026-11-05T12:21:13.476461-03:00 — Sonar, TOTP e autorização individual

Ran: coleta anterior aprovou cobertura nova92,48%; scanner via npm identificou6itens (gateSonarcoverage81,7%). Cinco corrigidos: asserção explícita, comparadores e validação de IDs fora de finally;71contratosPASS. Sexto item python:S4790 é HMAC-SHA1 do TOTP da fixture efêmera; revisão independente e6vetoresRFC PASS, suitePython16PASS. Usuário autorizou exclusivamente classificação contextual desse item após validação final. Justificativa em security-review-totp.md; nenhuma mutaçãoSonar realizada ainda. Nova coleta:804NodePASS/7skips/1falha no TLSsoak (EOFError baseline90requests e1timeout); frontend ainda emexecução. Repetir isolado com recursoslivres; não alterar limites nem inferir aprovação.

### 2026-11-05T12:49:22.634179-03:00 — Decisão TOTP aplicada e candidato das ferramentas

Ran: repetição isolada806NodePASS/0falhas/7skips, incluindoTLSsoak com mesmos limites; noveharnessesbrowserPASS, coberturaPASS, análise verificada38eaad8c-8a57-4f0e-9d51-c64752d2e040. Scannerconfirmou somente1item abertoTOTP, demais5corrigidos desapareceram. Após autorização individual, aplicada classificaçãoFALSE_POSITIVE com comentário/evidência apenas nessa ocorrência; token temporário revogado eusuáriodesativado, credenciaisleitura intactas. APIgateOK,zeroissuesabertas/zerohotspotspendentes,coverageSonar81,7%. validate:sonar desta rodada encerrouantesdaaplicação comexit1; não foi reescrito comoPASS. Ledgerregistra decisão207 e revalida3FPs deIPs sintéticos conforme revisãoindependente. Gate de checkout/últimoSHA eCI ainda pendentes. Próximo: registrar candidato ePR separada; merge dependeCSPNA0171/homologação/checks.

### 2026-11-05T13:07:47-03:00 — Alinhamento ao contrato de governança

Ran: validador identificou títulos de plano incompatíveis e ausência de entrada de diário sem frações de segundo no formato exigido. PlanoNA0170 recebeu as seções obrigatórias preservando escopo; esta entrada usa precisão de segundos/timezone. Nenhuma regra de validação ou autorização foi alterada. PR61 é draft, commitpublicadoe361a933c; checks/gates ainda pendentes, semmerge.

### 2026-11-05T13:20:57-03:00 — Correções dos checks da PR 61

Registrada exceção Gitleaks estrita por regra, caminho, linha e hash somente para o vetor público RFC 6238, após revisão independente. Nenhum segredo operacional permitido. Scanner local completo aprovado: 43 fixtures revisadas, zero achados não revisados; Semgrep zero achados e erros em 914 alvos. Validação de governança aprovada após ajuste dos títulos e formato temporal, sem alterar o validador. PR permanece draft; merge e sincronização de master pendentes.
