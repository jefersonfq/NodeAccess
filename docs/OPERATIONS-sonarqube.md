# SonarQube local — NodeAccess (NA-0085)

## Instalação e escopo

Instância local em `http://127.0.0.1:9000`, projeto privado `nodeaccess`. Runtime em `/home/jeferson/services/sonarqube`, fora do Git; template em `tools/sonarqube/compose.yaml`. Somente SonarQube publica porta, em loopback; PostgreSQL usa rede interna e volume próprio. Nenhuma conexão com banco/VPS NodeAccess.

Versões verificadas em 03/11/2026: SonarQube Community26.10.0.133078, PostgreSQL17.11-bookworm, scanner NPM5.0.2, Node24.21.0 já instalado. A [matriz oficial do banco](https://docs.sonarsource.com/sonarqube-community-build/server-installation/installing-the-database) suporta PostgreSQL15–18; versões foram confirmadas no registro oficial antes da instalação. Tags fixadas; digests efetivos ficam na evidência da frente.

O host observado usa Docker Engine28.1.1 no WSL Ubuntu20.04; não foi presumida instalação Docker Desktop. Memória31GiB, disponível16GiB no diagnóstico; limite dos novos serviços4GiB/2CPUs para Sonar e1GiB/1CPU para banco. Uso varia durante análise.

## Kernel e inicialização

Usuário autorizou somente `sysctl -w vm.max_map_count=524288`, aplicado temporariamente. Não foi criado `/etc/sysctl.d` nem alterado WSL/Docker permanentemente. Após reiniciar WSL, conferir o valor antes de subir a stack; se voltar65530, a operação precisa do ajuste novamente conforme autorização aplicável. Não desabilitar bootstrap checks do Elasticsearch. [Requisitos oficiais](https://docs.sonarsource.com/sonarqube-community-build/server-installation/pre-installation/linux).

```bash
cat /proc/sys/vm/max_map_count
docker compose -f /home/jeferson/services/sonarqube/compose.yaml config --quiet
docker compose -f /home/jeferson/services/sonarqube/compose.yaml up -d
curl -fsS http://127.0.0.1:9000/api/system/status
```

O banco deve estar healthy e a API responder UP. Parar apenas esta stack com `docker compose ... stop`; não usar `down -v`. Antes de upgrades, backup do PostgreSQL e configurações, volumes/extensões e plano de recuperação. Não foi ensaiado restore nesta frente.

## Credenciais e privilégios

Senha inicial admin alterada. `.env` e `credentials.json` em `/home/jeferson/services/sonarqube`, protegidos0600 e diretório0700, pertencentes ao usuário local. Não colar seus valores em chat, logs ou arquivos Git. O arquivo JSON contém admin e tokens; abrir somente localmente para acessar o painel.

Token de análise é `PROJECT_ANALYSIS_TOKEN` limitado ao projeto; outro token pertence a `nodeaccess-review`, com somente Browse no projeto. Expiração de30dias registrada no arquivo privado. Permissões padrão de análise/provisionamento globais e concessões amplas do grupo sonar-users foram removidas nesta instância nova. Não replicar essas mutações cegamente numa instância compartilhada. Renovar tokens antes de expirar, sem aumentar privilégios.

Telemetria desabilitada com `SONAR_TELEMETRY_ENABLE=false` e reinício antes da análise. A API de settings não aceita essa propriedade de startup; usar o Compose. [Configuração oficial](https://docs.sonarsource.com/sonarqube-community-build/server-installation/system-properties/system-properties).

## Análise

Código desta frente em `/tmp/nodeaccess-NA-0085` (branch `chore/NA-0085-20261103-sonarqube`). O projeto atual conserva outras frentes dirty. A análise deste worktree não inclui NA-0082/83/84 ainda isoladas. Documentos e planejamento ficam também em NodeAccess-current/docs.

Usar Node24.21+ (<25) conforme engines. Neste ambiente ele já existe em `/root/.npm/_npx/538786c08bcb9442/node_modules/node/bin`; outro usuário deve usar seu gerenciador de Node aprovado, sem depender do diretório root.

```bash
umask 077
npm exec -- vitest run --coverage --coverage.reportOnFailure=true --maxWorkers=2
# Mesmo se gerar LCOV, saída não zero continua sendo falha de testes/thresholds.
export SONAR_HOST_URL=http://127.0.0.1:9000
read -rsp 'Token de análise: ' SONAR_TOKEN; echo
export SONAR_TOKEN
npm run sonar:check
npm run sonar:analyze
unset SONAR_TOKEN
```

O wrapper usa `npm exec --package=@sonar/scan@5.0.2 -- sonar-scanner-npm`; baixa ferramenta para cache, sem alterar dependências/lock do NodeAccess. Recusa destino externo, credencial na configuração, falta de LCOV, Node incompatível e overrides agregados de configuração. Token vai pelo ambiente, não argv. O scanner aguarda Quality Gate por até600s: análise processada e gate reprovado são estados distintos. [Scanner oficial](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/scanners/npm/installing).

Fontes explícitas: backend/prisma, frontend, agent, shared e scripts/tools. Testes são classificados por padrões test/spec, sem remover código produtivo para melhorar resultado. Artefatos gerados/runtime ficam fora. A cobertura atual inventaria fontes executáveis dos workspaces, scripts e tools, incluindo arquivos sem execução no denominador. Os limites de 70% linhas, 70% funções e 60% branches continuam aplicados ao conjunto original `apps/backend/src/modules/**/*.service.ts`. O percentual global é informativo e o código novo tem gate próprio de 80%. Não reduzir thresholds nem excluir fontes para esconder lacunas.

## Exportação e triagem

```bash
read -rsp 'Token de consulta: ' SONAR_TOKEN; echo
export SONAR_TOKEN
npm run sonar:export
unset SONAR_TOKEN
npm run test:sonar
```

Exportador valida contrato da API instalada, pagina em100, limita retries/timeout, recusa redirects e resultados inconsistentes/incompletos. Salva issues, hotspots, gate e summary em `.sonar-reports/<timestamp-uuid>` (diretório0700, arquivos0600). `.sonar-reports` e `.scannerwork` ignorados pelo Git. Relatórios contêm caminhos/mensagens potencialmente sensíveis, portanto não publicar o bruto. Limite10000resultados por consulta; exceder falha explicitamente, exigindo estratégia adicional, nunca truncamento silencioso. A API não garante snapshot transacional enquanto novas análises são publicadas.

Primeiro confirmar achados no código e separar risco real, falsos positivos e escopo. Hotspot é solicitação de revisão, não vulnerabilidade comprovada. Corrigir até5itens de baixo risco por lote; testes e reanálise comprovam mudança. Autenticação, ACL/RBAC, cofre, tenant, criptografia, sessão e auditoria exigem revisão/autorização específica antes de alterações. Não desativar regras só para elevar a nota.

Na instalação inicial não havia enforcement no CI. A rotina adicionada posteriormente está descrita abaixo; não foi presumido suporte Community a análise de branches/PRs. SonarQube não substitui SCA, pentest, testes de autorização ou revisão humana.

## Evidências

[Plano e acompanhamento](changes/2026/11/NA-0085-sonarqube/plan.md), [registro](changes/2026/11/NA-0085-sonarqube/implementation.md) e [resultados](changes/2026/11/NA-0085-sonarqube/test-results.md). Status operacional, gate e triagem devem ser lidos nesses registros, não presumidos do roteiro inicial.

## Rotina normal após remediação (NA-0085/86/87/88)

A tabela integral está em [findings.html](sonarqube/findings.html), com [CSV](sonarqube/findings.csv) e [JSON](sonarqube/findings.json). Há uma linha por achado original; correções não apagam sua trilha. Achados novos são acrescentados com IDs de consulta novos. `fixed` indica alteração de código; `context_reviewed` indica comportamento avaliado com justificativa; `present/absent` indica a observação da reanálise, separada da decisão.

Para validar uma alteração, depois dos testes de domínio:

```bash
umask 077
export SONAR_HOST_URL=http://127.0.0.1:9000
read -rsp 'Token de análise: ' SONAR_TOKEN; echo
read -rsp 'Token de consulta: ' SONAR_REVIEW_TOKEN; echo
export SONAR_TOKEN SONAR_REVIEW_TOKEN
npm run validate:sonar
unset SONAR_TOKEN SONAR_REVIEW_TOKEN
```

O comando roda os testes dos validadores e a coleta Vitest, Node/V8 e navegador real, analisa, aguarda processamento, exporta e compara com `docs/sonarqube/accepted-findings.json`. Não reutiliza LCOV/task de execução anterior. Segredos não são passados aos testes do produto. Qualquer falha de testes/threshold, análise incompleta, gateERROR ou achado não revisado resulta em saída1. Na rotina local, condições ignoradas geram aviso explícito, sem dispensar os gates independentes de cobertura e achados. No CI, `ignoredConditions` precisa ser explicitamente false para aprovar. Logs/validation.json ficam privados em `.sonar-reports/validation-*`.

Somente contextos revisados podem entrar na baseline, com razão/evidência e multiplicidade. Se a linha se mover mantendo conteúdo, o hash continua útil; conteúdo/regra/caminho novos exigem revisão. A baseline não marca falso positivo no servidor e não desativa regras. Não executar análises concorrentes do mesmo projeto Community; a rotina recusa resultado substituído por outra análise. Lock local registraPID/data; remover lock órfão somente após confirmar término do processo.

O workflow `.github/workflows/sonarqube.yml` executa cobertura e análises reais da base e do candidato em SonarQube/PostgreSQL efêmeros no Ubuntu 24.04. Ele instala o Chromium correspondente ao lockfile, gera tokens separados e temporários, exige comparação verificável e remove os recursos ao terminar. Não usa tokens da instância WSL. Publica somente o resumo sanitizado. O ensaio local de aprovação/reprovação está em [NA-0092](changes/2026/11/NA-0092-sonar-ci/test-results.md); a execução no GitHub deve ser confirmada pelos checks do PR.

## Histórico e comparação

Para atualizar a tabela após exportar, execute `npm run sonar:catalog -- <baseline-original-privada.json> docs/sonarqube <issues-atuais-privado.json>`. A baseline original contém os533IDs e permanece privada. `discovered-findings.json` guarda apenas identificadores/regra/caminho/hash/severidade/tipo das ocorrências posteriores; o comando acrescenta descobertas sem apagar as que sumiram. Mensagens/trechos/autores não são copiados. Novas decisões devem ser registradas nos dispositions.json da frente e revisadas antes de atualizar accepted-findings.json.

A comparação mantém separadas a decisão e a observação. Um alerta contextual pode continuar aberto no Sonar; a baseline local não muda seu status, nem torna o Quality Gate verde. O comando normal também respeita o gate do servidor e os thresholds Vitest, portanto pode reprovar mesmo quando todos os alertas estão revisados.

Resultado consolidado: [NA-0089](changes/2026/11/NA-0089-sonar-integration/README.md), com branches recuperáveis, comparação e limites do gate. A instalação inicial NA0085 permanece como histórico.

## Cobertura abrangente — NA-0090

A rotina `npm run validate:sonar` usa agora o agregador Vitest + Node/V8 com base Git, mantendo gates legados por services e novo código ≥80%. Consulte [escopos, artefatos e limites da cobertura](sonarqube/coverage.md). Percentuais globais são informativos; LCOV inválido ou fonte alterada durante análise impede aprovação.

## Continuidade operacional — NA-0091

Backup, restauração isolada, renovação com sobreposição de tokens e manutenção agendada estão descritos no [guia de operação e recuperação](changes/2026/11/NA-0091-sonar-recovery/operations.md). Evidências sanitizadas registram a restauração equivalente e a primeira execução manual da manutenção instalada. Tokens e backups permanecem fora do repositório.
