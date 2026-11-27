# NA-0203 — Seis melhorias de adoção

Rodada autorizada pelo usuário em 2026-11-24. Continuidade da mesma branch `feature/NA-0203-20261124-vault-diagnostics`, base/HEAD `9d2fc71768a0e7aee34a6495e4ec11eceb338076`, LOCAL_WIP sem commit/publicação. Plano aprovado: seção de seis melhorias em plan.md. Seis melhorias implementadas e validadas localmente; não é aprovação de release.

## Implementação e fronteiras

- Login em etapas: modo username/password/both vinculado à autorização/consumo e envelope. Etapa usuário não descriptografa nem entrega senha. Etapa seguinte exige novo gesto/operação/documento, origem HTTPS exata e ACL/prova atuais.
- Assistência dentro do site: ativação explícita por até120s, activeTab+scripting existentes, sem permissão global. Sugestões somente metadados ACL; intenção da página não autoriza entrega. Confirmação privilegiada obrigatória, nonce efêmero ligado a sender/tab/frame0/documentId/origem e identidade.
- Salvar/atualizar: captura opt-in em formulário selecionado e submit com gesto real; proposta temporária no worker, sem escrita automática nem pressupor autenticação bem-sucedida. Senha não vai para storage.local/session/IndexedDB. Worker reiniciado perde a proposta. Nova senha em troca exige confirmação correspondente; senha antiga não é copiada para a proposta.
- Gerador: opções de tamanho/classes com Web Crypto; rascunho para confirmação no portal fica somente em memória com prazo, sem autosave ao retornar.
- Favoritos/recentes: IDs e instantes locais separados por escopo opaco de tenant/usuário/dispositivo e origem do portal. Sem nomes/senhas no armazenamento; listas/ações continuam dependentes da ACL atual. Histórico limitado, preferências não são concessões.
- Continuidade Hello: referência de preenchimento guardada em storage.session trusted, prazo120s e digest da autorização/dispositivo; retorno oferece confirmação, sem entrega automática. Nova navegação/identidade/expiração/cancelamento invalida contexto.

## Evidências locais

| Gate | Resultado | Artefato |
|---|---|---|
| Regressão integrada final | 1066 PASS;76 opt-in nesta chamada | `.tmp/NA-0203/adoption-regression-final.log` |
| SQL/Redis reais descartáveis | 74 PASS,0 falhas/skips, fontes estáveis e cleanup | `.tmp/NA-0203/mysql-1795567310-adb0c9/execution.json` |
| Chromium E7 pós-UI | 99 checks/21 cenários PASS; fontes estáveis | `.tmp/NA-0203/sites-browser/run-6OAS5n/result.json` |
| Adoção integrada com extensão/worker reais | 39 checks/5 seções PASS, fontes estáveis e cleanup | `.tmp/NA-0203/adoption-browser/run-RTDwbx/result.json` |
| Regressão extensão/consentimento | 52 checks PASS com toolbar real | `.tmp/NA-0203/extension-regression-final2/result.json` |
| Helper DOM/isolated world | 29 testes DOM +10 checks MV3 PASS | `.tmp/NA-0203/site-assistance/run-GBAkDi/result.json` e logs do agente |
| Cobertura dirigida de controles novos | 33 testes;89,73% statements,84,23% branches,93,75% funções,98,48% linhas | `.tmp/NA-0203/adoption-coverage.log` |
| Tipos/lint | Extensão/backend/frontend PASS; lint TS/Vue alterados zero avisos | `.tmp/NA-0203/adoption-*-types*.log`, `adoption-lint-final.log` e logs two-step |
| Build local extensão | 0.1.0, build `d602800a395e` | `.tmp/NA-0203/adoption-local-build.log` |
| Security scan final | PASS43 fixtures revisadas/0 novas,Semgrep0 achados/0 erros/1007 targets | `.tmp/NA-0203/adoption-security-target-final/scan-summary.json` |
| Sonar final | BLOCKED no preflight, sem análise/Quality Gate | `.tmp/NA-0203/adoption-sonar-final.log` |
| Manual/build frontend/bundle | Captura5/60 estados geométricos/2 ciclos tenant sem reconexão; pós-P2:3Node+18Vitest,reviewed5,build e inspeção159JS PASS | `.tmp/NA-0203/adoption-manual-capture.log` e `adoption-p2-manual-*.log` |

Os76 opt-in são74 SQL executados separadamente e2 harnesses HTTPS da rodada anterior. Não somar testes sobrepostos ou execuções repetidas. Cobertura dirigida cobre `core/site-interactions.ts`, `core/site-preferences.ts` e `adapters/site-interactions.ts`, não todo o repositório ou Quality Gate.

ESLint final cobre o escopo já configurado em `eslint.config.*`: TS/Vue em apps/backend/src, apps/frontend/src e apps/extension/src. A primeira chamada ampla também incluiu sete arquivos shared/manifest sem configuração e falhou com avisos de arquivo ignorado, sem erros de código (`adoption-lint-scope-initial.log`); comando corrigido ao escopo existente, sem alterar regras/exclusões. Schema shared validado por build e tipos. Uma tentativa do wrapper não tinha `rg`, não foi contada como validação; repetida com fallback disponível e pipefail, exit0. Build frontend conserva os avisos existentes de chunk/dependência.

Manual atualizado após evidência dos fluxos: oito fontes novas mapeadas, capítulo hosts hash pós-P2 `b543b8840774d5ff2bf31b3fa95b4d1fa6d60eb5497aef8fae3184a60ccbb7fd`; cinco imagens do portal precedem a última correção do editor da extensão, sem mudança de layout no portal. O fluxo corrigido possui oito capturas atuais da extensão, incluindo destino B com edição explícita, revista pelo principal. Testes manual3Node+18Vitest e reviewed5 reexecutados após P2. Servidor temporário38705 encerrado; harnesses declaram cleanup. Nenhum serviço do usuário foi encerrado.

Fingerprint E7 final `33354babd8b5cd4ecb98e3fbe48cef02f120e991e587ae8bd9f7a49984451c75`; manifesto `483c96f422d1e52e5984eb84275d73a2245546f5136ca39305f11cdf82055c23` inalterado. Adoção final `bed8a27348464650eccd62d3952ac4b0c43287666605f272be41da2598b8d51f`, fontes declaradas antes/depois iguais. Manifesto não recebeu permissões adicionais. Adoção usa API e aprovação Hello sintéticas, mas popup pela barra/XTest, worker, mensagens, injeção/JWE e UI reais. Não homologa Windows Hello físico. Sete capturas da rodada anterior revistas pelo principal, mais a captura atual de troca de destino com edição explícita; máscaras nos campos sensíveis, scroll vertical normal no editor, sem corte horizontal dos controles.

Regressão52 usa o mesmo contexto de action popup para erro offline, botão de nova tentativa e duas capturas de tema; não afirma recuperação de mensagem offline após reabrir. Bootstrap anterior em aba comum passou a ser corretamente recusado pelo guard; harness adaptado para o gesto real, sem spoof de sender nem relaxamento de asserções.

## Correções demonstradas durante a rodada

- Revisão independente encontrou captura/referência que poderia atravessar identidade, consumo após foco sem rechecagem de sessão e corrida que restaurava referência antiga. Corrigidos contexto original até a entrega, snapshot mesmo sem evento de storage, serialização/identificador da referência e consumo síncrono da capability.
- Prazo conferido após foco e durante espera da resposta; janela de revisão criada tardiamente não se torna privilegiada após invalidar identidade. Testes reproduzem esses casos.
- Chromium real recusou `undefined` nos argumentos da primeira inspeção do formulário. Adaptador agora omite o argumento opcional; regressão verifica serialização JSON. Baseline E7 `run-XoH8Qq` preservada, sem reduzir asserções.
- Captura de troca de senha sem campo de usuário podia apagar o usuário existente. Baseline FAIL em `adoption-username-baseline.log`; correção mínima preserva o usuário conhecido quando a captura não o contém, mantendo confirmação antes de escrever. SitePanel/gerador36 PASS e cenário integrado conferem o payload de atualização.
- Revisão final encontrou usuário herdado do item A ao selecionar B. O editor distingue agora valor originalmente capturado, valor derivado do destino e edição explícita. Baseline FAIL `adoption-target-switch-baseline.log`; quatro regressões adicionais, suíte SitePanel/gerador40 PASS e E2E39 PASS cobrem A→B→Novo, edição manual preservada e atualização somente do item B.
- Dois FAIL da regressão integrada eram fixtures de conexão sem URL de remetente. Atualizados para popup legítimo, mantendo e ampliando negativas de página web/URL ausente. Rodada final1066 PASS.

## Estado e limites

Roadmap atualizado uma única vez nesta interação: META-005/META-017, Revisões45, Original2027/IDs/prioridades/revisões anteriores preservados. Evidência `.tmp/NA-0203/adoption-roadmap-result.json`; SHA final `0233c4ddce149d77c150c44aa28ed6a8915f4bfcd18aa0a7f6d2fd4155029464`. Não repetir escrita nesta interação.

Username-only ainda lê ciphertext/IV no repositório, porém não chama descriptografia/sealer nem entrega senha. Captura é proposta após submit, sem garantir que o site aceitou o login. Assistência exige ativação no documento e expira; não há leitura global contínua. Reinício do worker perde rascunhos secretos; entrega/script já despachado não é recolhível. Favoritos não ampliam ACL e filtram os itens já carregados, com busca/paginação para os demais. Gates herdados de Windows Hello físico e pentest permanecem; nenhuma alteração habilita o piloto automaticamente ou autoriza uso com senhas reais. Revisão independente estática dos módulos, modos e último patch PASS_WITH_WARNINGS, sem bloqueio de código remanescente identificado. O revisor não executou os testes; evidências de execução são dos implementadores/harnesses, sem aprovação de release.
