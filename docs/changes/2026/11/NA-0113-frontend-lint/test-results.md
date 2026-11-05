# NA-0113 — Evidências locais

Base `47f06b51e693d91f5ed724b7b86e5362af75bc35`, worktree /tmp/nodeaccess-NA-0113, Node24.21.0/Chromium1234, Vite loopback sem proxy.

| Verificação | Resultado |
|---|---|
| ESLint dos32arquivosfrontendPR | Ran:zero erros/warnings |
| Vitestfrontend | Ran:742PASS+1opt-inSKIP,78arquivosPASS+1SKIP |
| Typecheckfrontend | Ran:PASS |
| Manualunit | Ran:18PASS |
| Terminal experience | Ran:PASS, mouselegacy/SGR/Unicode, scroll, zoom, pasteconfirm, autocomplete, sessão/reconexão/SFTP |
| Plataforma/licença | Ran:PASS2profiles,1persistência,reflexo confirmado |
| Estrutura | Ran:11templatesnormalizados equivalentes,11stylesbyte-idênticos,12/15scriptsemitidosidênticos |
| Revisão independente | Ran:PASS_WITH_WARNINGS,19cenáriosVM teclado/navegação; não éDOM |
| Manualcheckreviewed | Ran:PASS após revalidação;5capítulos atuais |
| Manualcapture | Ran:PASS cinco capturas, ajuda/busca/mobile/falha/retry/compartilhamento/tenant sem reconexão |
| PTYreal | Not applicable:nenhuma mudança resize/transporte |
| CoberturaGitdiff/Sonar | Pending:integração, semlimiaresreduzidos |

Capturas reais privadas: `/tmp/NA0113-terminal-review/{terminal,autocomplete,autocomplete-mobile,sessions,highlight}.png` e `/tmp/NA0113-platform-review/screenshots/platform-settings-{1,2}.png`. Revistas visualmente pelo autor. Terminaldesktop viewport1364×630, bottomGap10, semerrors. Autocomplete mobile298px dentro314px, cursor livre, gap5,8125px. Licença390×844, contraste medido13,8758, scroll interno preservado. Faixa de dicas inicial no mobile continua ocupando altura como no baseline; não introduzida por esta frente.

Nenhum screenshot/fluxo de produção. Protocolos API/WebSocket simulados nos harnesses; não comprovam infraestrutura remota. Três scripts com JSdistinto mantêm mesma intenção: router/nextTick explícitos com void e wrapper estável de evento. O revisor reproduziu efeitos/ordem e não inventou política nova de rejeição.
