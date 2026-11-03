# NA-0090 — Registro da implementação

## Pedido e objetivo

Executar a frente de cobertura autorizada: instrumentação abrangente, testes por risco, nova cobertura >=80% e gates legados 70/70/60 no mesmo conjunto de services sem reduções ou exclusões oportunistas.

## Implementação

Base SHA 4a77f7139600e70aa612e753418978d9b31b10ae; worktree /tmp/nodeaccess-NA-0090, branch test/NA-0090-20261103-sonar-coverage. LOCAL_WIP. Nenhuma edição de produto até medir baseline.

## Validação

Ran: inventário de fontes e leitura de configuração. Baseline de execução em preparação. Sem métricas inventadas.

## Recuperação

Worktree isolado, apenas testes/configuração/documentos. Sem publicação ou modificação de runtime.

## Pendências

Medir denominador real, identificar gaps, instrumentar todas as camadas, testes significativos, revisão independente. Planilha viva e entrega Git coordenadas pela raiz.

## Diário de interações

### 2026-11-03T15:50:20-03:00 — Início autorizado

Raiz delegou cobertura após pedido explícito do usuário. Skill lifecycle aplicada e plano criado antes de editar configuração. Identificados 981 arquivos e cerca de 227.850 linhas físicas; configuração cobre apenas services backend e não incorpora suites Node de agent/tooling. Viabilidade de gate amplo comunicada como risco, sem encerrar trabalho. Dependências shared isoladas no worktree.

### 2026-11-03T16:15:00-03:00 — Baseline e instrumentação abrangente

Baseline real no worktree: 2.714 testes Vitest passaram e 124 ficaram opt-in/skip. Escopo original de 97 services: linhas 3.830/9.333 (41,03%), funções 913/2.263 (40,34%), branches 3.405/9.832 (34,63%). Gates 70/70/60 REPROVADOS, déficit absoluto 2.704 linhas, 672 funções e 2.495 branches. A ampliação não altera esse contrato: cobertura global do produto/tools é informativa; novo código mensurável exige 80% por diff Git.

Primeira coleta combinada executou os 2.714 testes Vitest e 47 arquivos Node com saída zero; cobertura global informativa 17,62% linhas, 11,73% funções, 19,53% branches. Inventário de 988 fontes executáveis sem fonte ausente. O pipeline reprovou corretamente antes de validar o diff por contagem negativa gerada pelo conversor upstream ast-v8-to-istanbul@1.0.7 em branches else implícitos. Diagnóstico isolado comprovou que o negativo existe antes da mescla. Decisão revisada pela raiz: manter cada branch e denominador, converter apenas hits negativos para zero (não coberto), registrar arquivo/linha/rawCount/normalized/versão em conversionAnomalies. Outras inconsistências continuam falhando fechado. Regressão com execução Node/V8 real da política local em cópia descartável passou (3 testes do conversor). Raw V8 permanece privado em coverage/node-v8; não é evidência pública nem contém relatório inventado.

Novos testes de UserService exercitam tenant, licença, bcrypt real, preferências, evento de ACL e gravação/leitura/remoção reais de avatar em diretório temporário. Suíte em validação. Revisão independente dos 57 testes de IntegrationService na frente NA-0094: execução isolada passou; I/O de providers/repositório é simulado, crypto/JWT real, sem alegar integração com provider/DB real.

Dependências diretas de instrumentação promovem versões já existentes no lockfile, sem novos downloads ou alteração de node_modules canônico. `npm install --package-lock-only --ignore-scripts --offline` validou lockfile. Shared resolve para fontes locais durante Vitest para medição correta; Vue usa plugin oficial já instalado. Limites não foram reduzidos. Não executado Sonar nesta frente; scanner serializado pela raiz. Nenhum deploy, PR ou merge nesta frente até aqui.

### 2026-11-03T16:35:00-03:00 — Mapas autoritativos e rotina normal

Coleta #3 no worktree, com checkpoints das frentes 0091/0092/0094/0095/0096 incorporados: 2.939 testes Vitest PASS, 124 skip; 53 arquivos de testes Node com saída zero. Pipeline completo sem erro de parsing. Gate legado REPROVADO: linhas 5.335/9.333 (57,16%), funções 1.149/2.263 (50,77%), branches 4.809/9.832 (48,91%). Diff conjunto das ferramentas novas REPROVADO em 70,80% (1.120/1.582 unidades); nenhum fonte mensurável ausente. Helpers próprios da frente já mediram aproximadamente 94% combinado; déficits de CI/recovery enviados às respectivas frentes para testes reproduzíveis.

Mapas Node AST tornaram-se autoritativos para JS executado no runner nativo, com teste de não duplicação. Crédito Vitest de local-listeners (35 linhas/12 funções/28 branches) é descartado conservadoramente e listado; nenhuma fonte executável removida. Mesma anomalia upstream também foi observada no Vitest UserService:328; normalização negativa→zero aplica-se aos dois coletores e permanece explícita. Dados JSON importados (locales e catálogo de diagnóstico) têm lista própria, não denominador de código. Python/shell/SQL não são cobertos por V8 e essa limitação está documentada.

Rotina `validate:sonar` passou a chamar o agregador com SHA base explícito, validar summary/base/head/fingerprint/LCOV antes do scanner e manter falha final quando gate/testes reprovam. Cobertura stale, erro de pipeline e LCOV inválido bloqueiam scanner. Suites helpers + Sonar: 112 testes PASS. Testes UserService (21) e LocalAiIntegrationService (51) PASS; lint backend PASS após tipar mocks de I/O. Typecheck backend habitual PASS; verificação suplementar dos próprios testes em finalização, pois tsconfig normal exclui testes. Coleta #4 em andamento com novos checkpoints SFTP/web/CI; não há alegação de aprovação até resultado.

Documentação operacional criada em docs/sonarqube/coverage.md. Planilha viva coordenada pela raiz. Ensaios externos de restore são evidência operacional separada: nenhum crédito externo importado no gate, pois a CI deve reproduzir a execução.

### 2026-11-03T16:39:17-03:00 — Checkpoint de infraestrutura revisável

Coleta #4 concluiu sem erro de pipeline: gate legado REPROVADO em 58,85% linhas (5.497/9.340), 53,02% funções (1.200/2.263), 50,18% branches (4.938/9.840). Denominador cresceu legitimamente pela correção web NA-0097 (+7 linhas/+8 branches). Novo código conjunto: 74,64% (1.254/1.680), REPROVADO. Nenhuma fonte ausente. Novas simulações de recovery NA-0091 incorporadas depois dessa coleta aguardam medição seguinte.

Suite tooling completa: 129 PASS; após correção de race apontada em revisão independente, subset helpers/validate: 44 PASS. Validação rechecando HEAD e fingerprint após scanner/export impede aprovar fonte alterada durante análise. Revisor independente reproduziu subset e validou correção, sem bloqueio restante identificado. Nova cobertura ainda não aprovada; scanner não foi executado por esta frente.

Serviços novos: 72 testes PASS após DTOs completos e mocks tipados; lint PASS. Typecheck backend habitual PASS. Verificação suplementar incluindo os próprios testes revelou DTOs incompletos, corrigidos; restam duas incompatibilidades em telnet.session.ts:202/203 ao combinar tipos Vitest/Node no programa ampliado. Produto não foi alterado para contornar isso; verificação suplementar não é declarada PASS. Checkpoint separa infraestrutura e testes de serviços, sem publicação. Próximos passos: medir simulações recovery, adicionar contratos de sessão SSH gerenciada e fechar gaps legados com outras frentes.

Controle suplementar de tipos: usando somente o teste preexistente shared/health.test.ts junto ao produto, reproduzidas as mesmas duas incompatibilidades telnet.session.ts:202/203. Não restaram erros atribuídos aos novos testes. Logs privados /tmp/na0090-tests-typecheck.log e /tmp/na0090-control-typecheck.log; isso não transforma a verificação suplementar em PASS.

### 2026-11-03T19:45:11+00:00 — Contratos de sessão SSH gerenciada

17 testes focais PASS: trial/tenant antes da persistência e transporte, watchdog, pin/bastion, auditoria binária, resize, encerramento único, falhas de auditoria/persistência/cofre/conexão, input rejeitado/substituído e passthrough SFTP. Crypto real; transporte, DB e monitor simulados. Medição dirigida: 100/100 linhas, 34/38 funções, 58/61 branches; não substitui gate global. ESLint focal PASS. Revisão independente da raiz leu e reproduziu 17 PASS, sem bloqueios, com limites de SSH wire/PTY/DB real explícitos. Nenhuma modificação do runtime. Próxima frente HostService NA-0104 em branch própria; agregação global centralizada pela raiz em NA-0093.

### 2026-11-03T20:02:42+00:00 — Fase browser real incorporada ao coletor

Pedido da raiz: executar harnesses frontend/tabela durante a coleta para medir scripts realmente usados, sem importar ranges externos. Implementado tools/coverage/browser.mjs, chamado em subprocesso após suites Node e antes da consolidação. Vite configFile=false em porta loopback efêmera, HTML sintético, sem carregar app principal ou proxy/API/backend. Browser percorre 44 labels, 10 controles nativos e tabela com filtros, busca vazia, expansão, viewport mobile e teclado; gera cinco capturas em coverage/browser. Overrides de saída preservam docs rastreados e SONAR_ASSIGNED é fixado no dispositions versionado. Tokens Sonar não são repassados aos harnesses.

Teste local REAL PASS e revisão independente REAL PASS: Google Chrome for Testing 151.0.7922.34, cache Chromium1234 explicitamente escolhido. Revisor converteu V8 real e confirmou callback page.evaluate e sete callbacks internos com hits Node zero; não há crédito browser atribuído como Node. Subset de regressão: 54 PASS, incluindo subprocessos reais, timeout/kill, falha de spawn, setup/cleanup, bound loopback, API bloqueada e falha de browser preservada no gate. Diretórios700/logs600; frontend/tabela outputs privados. Nenhum scanner executado nesta frente.

Limite concreto: `node node_modules/playwright/cli.js install chromium` falhou porque a versão fixada não suporta ubuntu20.04-x64 deste WSL. Não foi forçada plataforma nem trocada dependência. A execução local usa PLAYWRIGHT_EXECUTABLE_PATH explícito para Chromium1234 existente; a CI Ubuntu24 instala Chromium1248 pelo CLI do lockfile e ainda depende de execução real no GitHub para validação final. Ausência de browser reprova a fase, sem fallback silencioso. Root integra e mede cobertura novamente na NA-0093; não declarar novo código80 nem gateslegados aprovados até esse resultado.

### 2026-11-03T20:13:42+00:00 — Escopo estático do coletor

Revisão encontrou exclusão genérica **/coverage/** que ocultava tools/coverage no Sonar e ESLint, embora o LCOV já coletasse essas fontes. Corrigido para coverage/**, limitado ao diretório de relatórios da raiz. Nenhuma fonte ou denominador foi removido. Ran: dois contratos Node PASS verificando padrões reais Sonar e API isPathIgnored do ESLint; ESLint focal de tools/coverage/*.mjs e configuração PASS. A configuração existente não aplica regras TypeScript aos arquivos JavaScript; este ajuste preserva as regras existentes. Scanner e nova medição são responsabilidade da integração NA-0093, não executados aqui. Documentos sincronizados na pasta canônica; atualização do roadmap consolidada pela raiz.
