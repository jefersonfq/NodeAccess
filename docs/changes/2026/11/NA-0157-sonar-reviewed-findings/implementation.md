# NA-0157 — Registro da implementação

## Pedido e objetivo

Tratar os achados Sonar com testes e revisão individual, preservando código necessário e sem aceitar riscos operacionais automaticamente.

## Implementação

Base SHA:28a77996deb4c004690e828c4a3a1f6dd292d198. Reconciliador em tools/sonarqube/reconcile.mjs vincula fonte/blobGit/HEAD/árvorelimpa, regra instalada, versão, hash/range e análise atual. Manifesto206 revisado depende das fontes integradas NA0155/NA0156. CI cria ator efêmero separado; validação local somenteGET exige revisões aplicadas e atuais. Nenhum gate/baseline foi reduzido.

## Validação

Ran:222contratos Sonar PASS;32contratos de proveniência antes dos últimos negativos, incluídos no total final. Revisor reproduziu81contratos e o ataque de remoção do manifesto. Lint estrito dos12arquivos PASS. Ensaio real com Git confirmou fonte/análise, falha parcial, idempotência, gateatual ERROR→OK semrescan e análise substituída; ator desativado/tokenrevogado/projetoremovido. Planned: análise fresca e gates completos na integração. Manual: concessão temporária local issueadmin e homologação dos fluxos, não inferidas.

## Recuperação

Branch fix/NA-0157-20261104-sonar-reviewed-findings preservada; revert porPR. Nenhum banco do produto migrado. Journal privado registra intenção anterior aoPOST e estado anterior; reabertura exige conferência explícita, nunca rollback automático sobre decisão humana. O resumoCI conserva IDs/ações sem chaves do servidor.

## Pendências

Manifesto206 é proposta:cinco ranges não correspondem à análise28a779 e exigem scannernovo. Projeto principal semissueadmin, semtransições/concessões realizadas. Três riscos operacionais seguem abertos. API não oferece CAS; a reconsulta reduz mas não elimina corrida entreGET/POST. Conta de laboratório é desativada, não apagada do histórico.

## Diário de interações

### 2026-11-04T12:22:35-03:00 — Plano de reconciliação técnica

Pedido: tratar todos os achados com testes e maior conformidade. Decisão: preservar comportamentos necessários e reproduzir revisões individuais no Sonar, sem aceite de riscos ou expansão da baseline. Feito: leitura da API instalada, diagnóstico dos10novosachados e plano isolado. Validações: nenhuma transição executada; fonte ainda não alterada. Limitações: revisão independente do plano/manifesto e teste real pendentes. Próximo passo: revisão GO e implementação com testes negativos.

### 2026-11-04T12:42:53-03:00 — Mecanismo, papéis e ensaio isolado

Revisores backend/tooling deram GO_WITH_RISKS. Implementados preflight por fonte/regra/range/hash/versão, paginação completa, estado humano preservado, comentário idempotente, journal síncrono com fsync antes da transição e revalidação de análise. Primeira revisão encontrou htmlDesc nulo com descrição em descriptionSections; corrigido e testado. Reconsulta imediata após comentário reduz corrida; API não oferece CAS, portanto não há atomicidade garantida contra edição concorrente entre último GET e POST.

CI utiliza ator efêmero distinto com browse+issueadmin apenas no projeto, limpeza explícita e stack descartável; token de leitura não é ampliado. Scanner agora passa e verifica sonar.scm.revision. Ran:215 contratos Sonar PASS, incluindo falhas de revisão/limpeza/gate. Ensaio real em projeto descartável: primeira tentativa não produziu dois achados esperados e encerrou FAIL com cleanup; segunda produziu dois alertas ANSI, aplicou falha parcial controlada, retomou sem duplicar comentário/decisão e rejeitou após segunda análise real. Cleanup de projeto/ator confirmado. Ensaio adicional base/head para demonstrar atualização do gate sem rescan está em execução.

Instância principal nodeaccess permanece sem transições: não existe papel issueadmin nela. Aplicação local depende de autorização específica para um ator temporário de projeto, a solicitar apenas após manifesto concreto/revisado; nenhuma concessão persistente é proposta. Manifesto e revisão final ainda pendentes.

### 2026-11-04T13:04:53-03:00 — Proveniência e resultado final da frente

Revisão encontrou retorno antecipado quando manifesto rastreado era removido; corrigido para validar checkout antes de considerar legado. Acrescentados negativos Gitassume-unchanged, fonteuntracked e alteração de documento durante lote. Fixture de validação ignora somente artefatos temporários como repositório real, mantendo asserções de freshness. Ran:222contratos PASS; reviewindependente81PASS antes dos dois últimos testes adicionais (produção idêntica). LabGitreal PASS com sourceblob/HEAD, falha parcial, retry, gateatual e nova análise. Histórico poranalysisId permanece separado do gateatualporprojectKey; tentativa históricaFAIL preservada. Nenhuma mutação no projeto principal. Próximo passo: integrar e executar scannerfresco; pedir concessão local somente sobre candidato concreto e revisado.

### 2026-11-04T13:06:52-03:00 — Correção de estrutura documental

Gate de governança recusou os títulos livres do plano. O conteúdo foi reorganizado nos títulos/checklist obrigatórios, sem alteração de código ou critérios. Novo checkpoint local substituirá o anterior ainda não publicado; governança repetida.
