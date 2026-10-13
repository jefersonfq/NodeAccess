# NA-0056 — Registro da implementação

## Pedido e objetivo
Fechar pendências autônomas de segurança com recuperação documentada: CSP aplicada e execução API/gateway sem root, sem alterar produção ou o desenvolvimento em andamento.

## Implementação
Worktree NodeAccess-security, branch security/NA-0056-20261011-csp-nonroot, base8eeef08b520a4ffde58cb0733b1e55ff7b247ef7. Quatro perfis Nginx aplicam CSP: scripts inline/eval bloqueados, workers e CDN Monaco versionado permitidos. O bootstrap do service worker preserva a lógica e passa ao build Vite com hash. O proxy de documentos remotos preserva CSP do upstream em rota estritamente delimitada.

Override docker-compose.nonroot.yml adota UID/GID1000 somente para API/gateway. Helper de manutenção exige comando explícito, inventário externo privado com gravação atômica/fsync, árvore estável e ausência de symlinks/hard links/arquivos especiais. Restore verifica identidades/modos e recupera donos anteriores; arquivos novos preservam conteúdo e recebem dono anterior da pasta registrada. Novos arquivos de operação são incluídos/verificados no release. Jobs CI incluem permissões, volume real, headers e navegador CSP.

## Validação
Ran: build Vite7.3.7; lint localizado; 15 testes de permissões/empacotamento; 24 respostas Nginx; migração/rollback em volume Docker; Monaco real com worker/edição e bloqueio inline/eval; smoke final de build do terminal; stack real com API/gateway UID1000, login/MFA, tenant, SSH/PTY/SFTP, readiness e SIGTERM.

Ran: full terminal sob CSP+Vite, após repetir uma falha transitória NET_NETWORK_CHANGED sem remover assertions. Esse full antecede somente a passagem do bootstrap para asset com hash; o smoke final cobre o build entregue. Stack Docker antecede esse mesmo ajuste de empacotamento.

Planned: revisão independente e checks no SHA candidato após commit/atualização da base; CI reconstruirá imagens finais. Manual: adoção do override em instalações existentes e homologação operacional. Skipped: produção, guacd, assinatura/release pública e fluxo de terceiros sem ambiente descartável.

Evidências privadas em reports/NA-0056: unit-release-tests.log, lint.log, nonroot-volume.json, nginx-headers.json, csp-security-final.json, terminal-build-final.json, terminal-full-csp.json, real-stack/report.json. O build final também está em /tmp/na56-frontend-build-final.log. São evidências de worktree sobre a base indicada, sem declarar SHA futuro como validado.

## Recuperação
Reversão por PR para a base/checkpoint e imagens compatíveis. CSP anterior recuperável no Git. Para voltar nonroot, parar todos os escritores, restaurar inventários de cada volume/diretório e só então remover o override. Falha/identidade divergente interrompe e requer revisão; inventário não substitui backup integral. Não há migração de schema ou conteúdo. Serviços ativos e produção preservados.

## Pendências
FUT003 parcialmente tratado: override disponível e ensaiado, adoção operacional pendente. Frontend/TLS Compose e guacd não passaram a nonroot nesta frente. CSP não isola conteúdo remoto que compartilha origem; isso requer desenho separado. Self-hosting/SRI do Monaco segue pendente; estilos inline necessários à UI permanecem. Release/homologação humana não presumidas. Configurações HA/update devem carregar explicitamente o override antes da adoção.

## Diário de interações
### Histórico da sessão — Pendências autônomas
Usuário pediu ajustes fim a fim sem interação. Criada frente paralela autorizada; opt-in nonroot evita quebrar instalações existentes. Iniciados ensaios isolados.

### Histórico da sessão — Compatibilidade e recuperação
Ensaio constatou que root com cap_drop ALL também perde leitura de arquivos novos0600 do UID1000. Ajustado restore para inventariar os arquivos novos e recuperar dono da pasta anterior, preservando conteúdo. CSP passou com Monaco atual sem unsafe-eval; não houve dependência nova. Full browser aprovado após falha transitória de rede; bootstrap final recebe hash do Vite. Próximo passo: revisão independente, atualização da base NA0055 e CI no candidato.

### 2026-10-12T22:03:25-03:00 — Revisão e formalização do registro
Registro retrospectivo das interações anteriores, cujo horário exato não foi preservado. Validador independente solicitou limites de UID/GID antes de qualquer mutação e seções obrigatórias do plano; ambos corrigidos. Foram aprovados 14 testes do helper e um de empacotamento. Restore parcialmente interrompido exige revisão manual; retomada automática fora do escopo.

Limites do navegador: Chromium e worker JavaScript do Monaco foram exercitados; Firefox, WebKit e worker JSON não foram executados. Isso não declara cobertura de todos os navegadores.

Ran: WS e WSS reais de mesma origem em Chromium, via Nginx HTTP e HTTPS descartáveis, com CSP aplicada. A primeira fixture usava resposta sintetizada por Playwright e disparou Local Network Access; substituída por arquivos de prova temporários servidos pelo Nginx, sem desabilitar essa proteção. Relatórios csp-security-final.json e csp-security-tls.json aprovados.
