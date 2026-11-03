# NA-0127 — Registro da implementação

## Pedido e objetivo

Corrigir origem de checkoutalterado noCI mantendo guarda.

## Implementação

Base SHA8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d; branch fix/NA-0127-20261103-ci-clean-checkout. Nenhuma alteraçãoNA0093.

## Validação

Ran:npmci antes/depois comfilemode=true, hashes/modes, Prisma/buildshared/135testes no clone corrigido;136testesSonar no worktree incluindo negativo; ESLint0warnings.

## Recuperação

Reverter delta desta frente.

## Pendências

Integrar/publicar delta e reexecutar jobGitHub; planilha/índice comcoordenação.

## Diário de interações

### 2026-11-03T19:00:00-03:00 — Diagnóstico inicial

CI135testesSonarPASS mas pré-condição cleancheckout falhou. Entry bin doagent possui shebang e modoGit100644; implementação instalada npm/bin-links/fix-bin.js executa chmod. RepoWSLcore.filemode=false; hipótese será reproduzida emcloneisolado semmudar configuração compartilhada.

### 2026-11-03T19:07:28-03:00 — Causa reproduzida e correção validada

Clone privado Linux comcore.filemode=true e base8dae9b49a iniciou limpo. npmci terminou0 e alterou exclusivamente apps/agent/src/index.js:modo100644→100755, conteúdoSHA256 idêntico189faaf866508ef09ff65eec9d5251ee6351c37db0959328736fa66704d3c6fd. Packageagent declara esse arquivo como bin e contém shebang; npm/bin-links/fix-bin.js executa chmod. WSLdo repositório usa core.filemode=false e ocultava o mesmo metadado; nenhuma configuração Git compartilhada foi alterada.

Correção mínima versiona100755 noentrypoint, sem diferença de bytes. Guarda ci-run permanece intacta. Novo contrato cria alteração exclusivamente de modo emfixtureGitfilemode=true e prova rejeiçãoCI_CLEAN_TRACKED_CHECKOUT_REQUIRED antes de coverage/Docker. A mesma guarda foi invocada sobre alteração real produzida npm e rejeitou antesDocker.

Após versionar correção equivalente apenas no clone privado, segunda instalação npmci terminou0 e checkoutpermaneceu limpo. GeraçãoPrisma6.19.3, buildshared e135testes originaisSonar também passaram, mantendo statusrastreadovazio e filemode=true. Worktreefrente:136testesSonarPASS(135+regressão), ESLintteste0warnings,diffcheckPASS. Node24.21.0 local coincideGitHub; npm local11.12.1 versus11.19.0 observadoGitHub, limite explicitado sem afirmar execuçãohosted concluída. Chromiuminstall não repetido, pois alteração já foi reproduzida isoladamente emnpmci antes dele.

Revisão independente toolingPASS: índice sómodechange0/0conteúdo e negativo1/1reproduzido, sem bloqueador. Logs locais privados em/tmp/NA0127-*.log, resumo sanitizado emreproduction-evidence.json. Sem scanner/Docker/VPS, sem alteração de configuração efetiva base/head ou gates. Documentos próprios sincronizados àpastacanônica. Próximo passo: coordenação integra e reexecuta jobpublicado.
