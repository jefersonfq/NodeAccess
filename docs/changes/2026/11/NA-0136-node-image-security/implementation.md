# NA-0136 — Registro da implementação

## Pedido e objetivo
Corrigir achadosNode reais dasimagensbackend/TLS-agent semwaiver.

## Implementação
Base SHAb76faaec6031f3ebed1372a65dcede08f930cde0; worktree /tmp/nodeaccess-NA-0136; planoantesedição.

## Validação
Planned: build/scannerreal econtratosTLS/runtime.

## Recuperação
Imagenspróprias, nenhumcontainerexistente alterado.

## Pendências
Checks/revisão; raizcoordenaCI/publicação/roadmap.

## Diário de interações

### 2026-11-03T20:04:51-03:00 — Diagnóstico verificado
Artefato13277359334 baixado comAuthorization sóAPI GitHub, redirectsemcredencial. Backend/TLS-agentNode24.21.0 têmCritical111497 eHigh105482/105483/106069; fix24.22.1. FonteNodeoficial confirma. ManifestDockeroficial24.22.1-alpine digestsha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53, amd64sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420. Semalteração emhostsusuário.

### 2026-11-03T20:09:21-03:00 — Builds e runtime
Ran: backendruntime eTLS-agent DockerbuildPASS (/tmp/na0136-backend-build.log,/tmp/na0136-tls-build.log). Nodev24.22.1/OpenSSL3.5.9 confirmados dentro dasduasimagens; probesválidoIP+rejeiçãoIPnão-canônico/fullwidth, DNSNUL, Brotli roundtrip/invalidinput eexportconstanteFORMAT_BLOCK_SWITCH PASS. Não é reproduçãoexploitCVE: contratosdirecionados eversãooficialcorrigida. Bcryptnativo hash/compare eimportPrismaPASS. FonteNodeclassifica111497High; GrypeCIclassificouCritical, nãoatribuirCriticalaoNodeblog.
Ran: integraçãoTLSreal PASS (/tmp/na0136-tls-integration.log): Nginx/ACMEHTTP01/certswap/WS-SSHcontinuidade/recovery/outbox/lock, fixturedescartável. Orquestradorhost24.21.0, workerreal24.22.1; próximaCIalinhada24.22.1 pela frenteNA0137. Frontendbuild e scannerimagens emandamento.

### 2026-11-03T20:11:00-03:00 — Scanner final e TLS alinhado
Ran: Grypeoriginal por digest PASS para backend1f62e46e5613d33091e9546fd7ecc7574b5633ef373d20f99faaba89e3c61c29 eTLS942ecf10f9abf95a18193657b8f66904847deabb5f4e804eb8dae8ba3794b62e. ZeroHigh/Critical; backend3Medium, TLS5Medium/1Low. Semwaivers ouretag; referências própriasna0136. Evidência sanitizada validation.json, rawprivado artifacts/security/images. Ran:TLSreal repetido comhostNode24.22.1oficial verificadopelaraiz eworker24.22.1 PASS (/tmp/na0136-tls-integration-node24221.log).

### 2026-11-03T20:12:06-03:00 — Build frontend e revisão
Ran: frontendprod Dockerbuild PASS, imagem52e49d01cabdebc41264e24a842a9c897b22078364b6d3d7760346bedeb6a04b (/tmp/na0136-frontend-build.log), semrelaxar chunkwarning950. Guardasdepolítica8/8 PASS sobNode24.22.1 (/tmp/na0136-policy-node24221.log). Tooling revisãoestática PASS_WITH_WARNINGS: quatrorefsNode nos3arquivos coerentes, semmudança dehooks/policy; evidênciasruntime/scanner atribuídas ao autor. Build/scanner não repetidos pelorevisor. Raiz verificoureleaseoficial independentemente. Container-stackreal emcurso comtagspróprias, Nodehost24.22.1 e dadosdescartáveis.

### 2026-11-03T20:14:01-03:00 — Expectativa antiga no ensaio
Primeirocontainer-stack avançou migrações2x/nativo/read-only/UID1000, depoisfalhouassertionliteral /^v24\.21\.0$/ embora retornassev24.22.1. Raizautorizou alinhar paraexata24.22.1, nãofaixa. Busca tools/scripts confirmouúnicaassertionhardcoded; tagsprovider sãoNA0137, guardsmínimos24.21+ efixturesdecompatibilidade preservados. Repetirensaio completo.

### 2026-11-03T20:16:11-03:00 — Stack completa validada
Ran: container-stackreal FINAL PASS (/tmp/na0136-container-stack-final.log) após ajustarassertionexata24.22.1. Migrações2x incluindoUIDnão-root/read-only; API/gatewayUID1000/capabilitiesdrop; HTTPS/SPA/assets/WS; login/MFA/isolaçãotenant/refresh/revogação; gatewayreal→OpenSSHdescartável comhostkeychallenge/approval/credenciais/shell/resizePTY/SFTPhome/list/cleanup; Redisunavailable readiness503/liveness200 e recuperação; SIGTERMlimpo e logssemquerytokens. Nenhumcontainerlabrestante. TLSworkerNode24.22.1 exato validado. Lintfocalharness0/0. Dados, credenciais e containerssomentedescartáveis, semVPS.
Diferença deimagemfrontendbuild compartilhaNode novo, runtimeNginxinalterado; scannerfinal desta frente cobriu somentebackend/TLS quefalharamCI, restantesimagens têmCI anteriorPASS e devem repetirCIintegrado. Nenhumresultado deWindows/produção inferido.

### 2026-11-03T20:17:03-03:00 — Revisão final e checkpoint
Raiz leu delta final harnesslinha163: somenteassertionancoradaexata24.22.1, PASS_WITH_WARNINGS complementar àrevisão toolingsobrepins; semrelaxarcontrato. Autorizoucheckpoint apósstackreal e scannerPASS. CIhospedado candidato final epublicação seguem pelaraiz; nãoexecutadosnesta frente.
