# NA-0169 — Registro da implementação

## Pedido e objetivo
Implementar TACACS+ exclusivo TLS e aviso na integração; sem clientes legados.

## Implementação
Base SHA df8482674781c24a92f3f24d551c4e392297c9f1. Implementação do transporte TLS exclusivo, identidade por certificado, migração, API, interface e laboratórios concluída no WIP; coleta integrada aprovada, gates do candidato final pendentes.

## Validação
Ran: baseline focal, testes de protocolo/API, TLS real, MySQL, Redis, cliente Python, soak, watchdog e Chromium. Ran: coleta integrada WIP aprovada. Planned: Sonar e CI no candidato final.

## Recuperação
Worktree /tmp/nodeaccess-NA-0169 preserva pasta principal suja. PR59 anterior sem merge.

## Pendências
Concluir validação do SHA final, Sonar e CI. Sem homologação humana, deploy ou merge.

## Diário de interações

### 2026-11-04T20:29:34-03:00 — Autorização fim a fim
Usuário autorizou TLS exclusivo e mensagem explícita de incompatibilidade por segurança na integração. Sem fallback legado; notaA depende de scanner. Docs/planilha canônicos na raiz do projeto.


### 2026-11-04T20:39:50-03:00 — Implementação e validações focais

BaselineAPI27PASS; contratoTLS/pinAPI38PASS com validação de formato, payloadlegadorecusado, auditoria/colisões. Migrações completas no MySQL próprio na0169-mysqlPASS; Redis próprio isolado. Daemon74 testesTLS PASS antes dos reforços de vinculaçãoASCII/erroflag; reteste emexecução. Laboratório independentePythonSSLstdlib15checksTLS+6health+26live+7CLIemuladoPASS. Soak31,423s/4clientes/1356pedidos: baseline526semfalhas,fault326com82erros81timeoutsinjetados,recuperação504semfalhas; sem grants indevidos e pendências zeradas. PKI inicial incompatívelOpenSSL1.1.1f corrigida; não foi falha deprotocolo.

UIbaselinecapturada; novo ensaioTLS desktop/mobile passou, revisão visual encontrou recuos excessivos e alertas longos: ajustados localmente, revalidação final pendente. Cancelar ativação agora restaura switchàpolítica persistida; correção necessáriaUX. APIteve2erros/13avisoslintlegados noarquivoalterado, corrigidos com tipos explícitos/validação dos comandos persistidos; lint estritoPASS.

Guia/PRD/resumos descrevem TLS exclusivo, certificados/CRLs,porta300,recadastroepin,semfallback. Revisão planoGO_WITH_RISKS incorporada: limites préhandshake, retomadareal, CRL/cadeia/EKU, erroRFCflag e contextodeidentityporconexão. Compilação/watchdog/revisãofinal/Sonar/CIaindapendentes. NenhumdeployVPS/merge/homologação.


### 2026-11-04T20:49:12-03:00 — Revisão e regressões finais por domínio

Ran: 79/79 testes de transporte, ativação, resiliência e PKI; 38/38 testes da API. Typecheck backend/frontend, build backend e lint estrito dos arquivos alterados passaram. A revisão independente identificou que CRL inválida recusava conexão mas podia permitir startup; bootstrap agora verifica assinatura, emissor e vigência via OpenSSL, sem gravar chave privada. Casos de CRL expirada, assinatura inválida e ausência de próxima atualização passaram.

Ran: watchdog no build final passou, com readiness 503 durante falha, saída controlada 1 após 18,864 s e nenhuma confirmação AAA. Somente proxy de banco descartável foi interrompido; reinício por supervisor não foi testado. UI real passou em cinco grupos de verificações, desktop/mobile e teclado; revisão visual confirmou aviso legível e ausência de overflow. A API da UI é interceptada; testes reais de backend são independentes. O nono fluxo Chromium obrigatório foi integrado ao coletor de cobertura, com prova vinculada à execução e bloqueio de skip silencioso; 28/28 contratos do coletor passaram. Nenhum limiar ou exclusão foi relaxado.

Documentação sincronizada por diff pontual em docs do projeto principal, preservando alterações alheias. Planilha viva registra a nova direção e o estado real. Manual integrado não mapeia esta tela. SSH, WebSocket e área útil do terminal não mudaram, portanto ensaios PTY/terminal não foram acionados por esta frente. Fontes de dois falsos positivos existentes foram revistas individualmente; a identidade Sonar do mock alterado ainda depende de nova análise. Sem novos riscos aceitos. Cobertura completa em execução; nota A, CI e entrega não declarados.


### 2026-11-04T20:56:16-03:00 — Coleta integrada e isolamento de laboratório

Ran: 3.658 Vitest e 655 Node passaram (125/7 skips). Chromium integrado falhou por import dinâmico de SettingsView; reprodução focal passou. Dois Vite usavam o mesmo cache físico. Encerrado somente o servidor auxiliar desta frente e iniciada nova coleta, sem ignorar pageerror ou relaxar timeout. Causa do primeiro erro permanece hipótese de concorrência de cache. Scan Semgrep/Gitleaks passou após revisão independente da fixture sintética que mudou de linha/hash. Captura do modal recebeu espera por encerramento dos toasts e transições, restrita ao harness; ensaio passou. Scanner preliminar usado para descoberta de achados, não como aprovação de cobertura ou SHA final.


### 2026-11-04T21:17:15-03:00 — Cobertura real e revisão de isolamento

Ran: segunda bateria completa passou em todos os nove harnesses Chromium, 3.658 Vitest e 655 Node, mas reprovou a cobertura incremental (59,8651%). Foram ampliados os cenários de credenciais, grants, eventos e revogação no harness TLS. Captura isolada ampliada passou; seus percentuais não são tratados como o gate agregado.

Foi integrado laboratório TLS obrigatório ao coletor, com MySQL/Redis próprios, imagens por digest, migrações, build, AAA/CLI, health, soak e watchdog. Focal real passou em 233 s, 527 pedidos, quatro etapas e limpeza confirmada. Cliente Python teve 89/102 linhas executadas de fato. Delta posterior acrescenta testes de integridade e cobertura real do próprio medidor Python, com dados sintéticos separados dos samples reais. Contratos do coletor: 34 PASS; contratos Python e lint passaram. Dois S6324 do fixture CRL foram corrigidos por leitura TLV em bytes e 79 testes passaram novamente. Sem MD5 encontrado no módulo.

Scan de segurança: Semgrep 0 achados em 903 arquivos, Gitleaks 42 fixtures revistas e 0 pendências. Revisão independente confirmou a fidelidade da medição, mas identificou que Docker remoto herdado poderia provisionar fora do laboratório local. Foi solicitado o encerramento da terceira coleta antes da fase Docker para implementar rejeição de endpoint remoto e fixação do socket local; logs posteriores indicaram sobreposição de subprocessos, portanto aquela tentativa não serve como evidência de execução exclusiva. Nenhum resultado dessa coleta interrompida foi aprovado. Gates finais, Sonar, CI e homologação permanecem pendentes; sem commit/push/merge/deploy nesta frente.


### 2026-11-04T21:41:01-03:00 — Laboratório compilado e diagnóstico de falhas

A integração inicial do laboratório ao coletor falhou no soak sob V8; o agregado também recusou offsets TypeScript transformados por tsx. O conversor permaneceu estrito. Os cinco módulos de laboratório passaram a importar o backend compilado e a executar Node diretamente, com build prévio obrigatório. A fonte TypeScript continua no inventário e conserva cobertura autoritativa Vitest; nenhum crédito foi inventado para offsets transformados.

O helper agora preserva diagnóstico privado limitado em falhas. Um focal compilado atingiu o limite de build de 120 s sob carga compartilhada do WSL (load próximo de20, com testes de outro projeto). Processos alheios foram preservados. Somente o orçamento de preparação do build backend foi elevado para300 s e o orçamento total do laboratório para900 s; o timeout de200 ms do soak, a injeção de falhas e as asserções permaneceram iguais.

Ran: focal final compilado/V8 passou, três testes,623 pedidos de soak,quatro etapas e cleanup confirmado, em269,8 s. Python real89/102linhas; helper também medido pelos próprios contratos. O conversor nativo aceitou os oito arquivos executados, sem anomalias. Inicialmente houve logs intercalados de coletores e falha de duplo clique em terminal; após término, a ausência de outro coletor neste worktree foi conferida antes da nova coleta completa. Nenhuma falha anterior foi considerada aprovação.

Atalho test:network-access:lab passou a usar recursos Docker próprios; soak manual exige arquivo de ambiente explícito e build, sem fallback para apps/backend/.env. Cache Python gerado foi ignorado no Git; fontes Python continuam analisadas. Os containers iniciais na0169-mysql/redis foram removidos após conferir rótulo de propriedade. Nova coleta integrada em execução; Sonar/CI e homologação humana ainda pendentes.


### 2026-11-04T21:51:57-03:00 — Consolidação do candidato

Ran: coleta integrada aprovada com3.658Vitest/673Node,125/7skips,noveharnessesChromium e85,78199%decobertura incremental. Provas TLS/Python atuais verificadas, quatroetapas laboratoriais e798requisições de soak comcleanup. Lint28arquivosPASS; Semgrep0/903arquivos eGitleaks42fixturesrevisadas/0pendências. Revisão independente PASS_WITH_WARNINGS confirmou fontes/fingerprint, hashes e isolamento. As falhas anteriores permanecem no histórico e não foram convertidas em aprovação.

Preparado commit coerente da NA-0169 na branch isolada, dentro da autorização desta frente. Após o commit serão executados os gates do SHA final; SonarA não é declarado antecipadamente. PR será empilhado sobre a basePR59para revisão, com merge/homologação ainda pendentes e semdeploy.
