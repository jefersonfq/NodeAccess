# NA-0089 — Validação integrada

Gate técnico ainda em validação; gate de cobertura FAIL. Sem publicação remota ou homologação humana presumida.

| Verificação | Resultado observado |
|---|---|
| Suite integrada instrumentada | Ran:276 arquivos/2711 testes PASS;26 arquivos/121 testes opt-in skipped; nenhum teste falhou |
| Cobertura | Ran:40,93% linhas;40,27% funções;34,51% branches; FAIL contra70/70/60 originais |
| Compilação | Ran:npm run build PASS (shared/backend/frontend), aviso de chunk preexistente |
| Tipos | Ran:npm run typecheck PASS |
| Rotina/helpers | Ran:42 testes Node PASS |
| Terminal | Ran:test:terminal-experience:web PASS, fixture API/WebSocket local, mouse/Unicode/scroll/paste e fluxo completo |
| Labels e controles | Ran:44 labels e10 controles nativos; nome acessível/foco/mobile PASS |
| SFTP real | Ran:3 testes PASS em OpenSSH descartável; criação0600, binário65KiB, preexistente/symlink preservados, uploadScript0700/checksum, repetição negada |
| Tabela | Ran:533 linhas com decisões; filtros/vazio/detalhes/teclado/mobile;3 capturas |
| XLSX | Ran:ZIP/XML válidos,50IDs únicos nas células, sheet1 original preservada |
| Scanner agregado | Ran:295issues/0hotspots;0não revisados;244correções ausentes; gateERROR por new_coverage3,5%<80%;new_violations0 |
| PTY real | Skipped:não houve alteração de resize/WebSocket/transporte terminal; uploadSFTP validado no servidor real descartável |
| Homologação humana | Manual:pendente; DOM/capturas não simulam aprovação com leitor de tela humano |

## Revisão independente

Backend:PASS em ce335508e após corrigir regressão de separadores CR/LF;209 testes subset,159 normalizer,8 artefatos e20.000 entradas diferenciais. Frontend:PASS em5949b3479,28 testes reproduzidos e44+10controles verificados, capturas mobile examinadas. Tooling:PASS independente em f59fe6890;9 testes focados reproduzidos,69 evidências anteriores conferidas. Limites:waitFor requer predicado síncrono como nos consumidores atuais; overrides explícitos de artefato continuam sob responsabilidade do operador. SFTP opt-in recebeu revisão e ajuste de deadlineglobal no checkpoint posterior, a incorporar antes da análise final.

## Limites

Cobertura atual instrumenta somente servicesbackend; Sonar global usa outro denominador. Nenhum threshold alterado. Revisão contextual não é correção nem supressão. UID uniforme obrigatório no storage compartilhado. A origem da análise é o worktree isolado, não o conjunto de alterações não commitadas do workspace principal. Nenhum dado real de usuário usado nas simulações.

## Evidências locais reproduzíveis

Logs temporários /tmp/na0089-{coverage,build,typecheck,tooling-tests,terminal,dom,sftp-real}.log. Relatórios brutos Sonar são privados e ignorados pelo Git. Capturas da tabela emNA0085/screenshots, demais emNA0087/screenshots; execução integrada reafirma os fluxos. Não publicar tokens, credenciais ou mensagens brutas do scanner.

## Revisão dos residuais e baseline

Ran:SCIM substituído por parser linear (13 testes service na integração;17 na suite ampliada do autor), revisão independente PASS. Quatro labels passaram a usar for/id no input real; DOM44+10 revalidado independentemente, inclusive clique→foco. Canvas remoto mantém application com histórico e evidência de teclado/pointer/paste;context_reviewed após correção, não ausência presumida. Harness removeu Function e usa parser literal restrito3testes; diretivas use strict restauradas em2harnesses. Falha de screenshot injetada confirmou saída1 normal e fechamento do browser; fluxo normal saiu0. Sem supressão de regras.

Baseline contextual revisada independentemente:235assinaturas/295ocorrências, sem fixed incluído e sem sobreposição. SHA256 aprovado18f7da99e04529765c24a0623836e70957fdb6663cb117b6b899cd7d98577d83. Revisão encontrou conversão incorreta de evidence string em caracteres no gerador ad hoc; normalizada para lista de referências antes da aprovação. Assinaturas/contagens não foram alteradas. A primeira execução da rotina carregou a versão anterior das referências; comparação final usará o arquivo aprovado. Scripts Sonar33testes PASS, incluindo persistência sanitizada dos achados descobertos.

## Resultado da rotina real e correção da fixture

Ran:`npm run validate:sonar` executou cobertura/scanner/export, confirmou análise e comparou295ocorrências contra baseline (0inesperadas,0hotspots). Suite2714PASS/124skipped; cobertura41,03/40,34/34,63 FAIL. SonarERROR somente emnew_coverage3,5%<80%;new_violations0 e duplicação nova0,34026%<3%. Análise e8a7d214-f0d8-40c3-a019-17216cb0e12d.

A execução real também detectou1falha de fixture dos testesSonar: mkdir0755 sobumask077 criava0700 e o teste esperava rejeição de diretório público. Corrigida a montagem da fixture com chmod0755 explícito, sem alterar proteção do exportador ou assertiva. Ran:33testesPASS sobumask077 após correção. Rotina completa será repetida no checkpoint commitado; evidência pós-commit mantém SHA/checks fora de commits recursivos.

Tabela final539ocorrências:244fixed/absent e295context_reviewed/present; nenhum pending ou fixed ainda aberto. São238originais corrigidos,295originais contextualizados e6novos corrigidos. 64VULNERABILITY/109BUG/122CODE_SMELL restantes são classificações do scanner contextualizadas individualmente, não confirmação de explorabilidade. Nenhuma supressão ou transição em massa no servidor.
