# NA-0203 — Cinco melhorias e revisão da Central/Configurações

Registro histórico desta rodada. A continuidade posterior com seis melhorias de adoção, incluindo suporte a login em etapas que substitui a limitação histórica abaixo, está em [adoption-results.md](adoption-results.md).

Rodada autorizada em 2026-11-24, mesma branch local e base `9d2fc71768a0e7aee34a6495e4ec11eceb338076`. Cinco melhorias implementadas e validadas localmente, além da Central e orientação de configuração. Sem commit/publicação; Sonar e gates humanos pendentes, sem aprovação de release.

| Verificação desta rodada | Resultado | Evidência |
|---|---|---|
| Regressão integrada após correção da rota | 928 PASS /74 opt-in nesta chamada | `.tmp/NA-0203/hardening-tests-remount.log` |
| SQL/Redis descartáveis | 72 PASS, zero skips, fontes estáveis | `.tmp/NA-0203/mysql-1795563039-ee5e5c/execution.json` |
| Matriz Chromium | 95 checks /21 cenários PASS | `.tmp/NA-0203/sites-browser/run-ovhdY6/result.json` |
| Site→host→SSH real | 13 asserções (12 nomes únicos) PASS, PTY30×153 igual ao navegador, fontes estáveis e cleanup | `.tmp/NA-0203/site-terminal-real/run-4EBwIH/result.json` |
| Administração HTTPS | 14 cenários,25 capturas,8 propostas/aplicações PASS | `.tmp/NA-0188/administration-9yxqUT/execution.json` |
| Central de Segurança | 8 cenários Playwright PASS; Node19 e Vue15 PASS | `.tmp/NA0203/security-final/report.json` e logs do agente |
| Volume/UI | 22 checks PASS com 2500 sites/5000 hosts sintéticos; harness mantido | `.tmp/sites-volume/run-STOqXA/result.json` |
| Tipos/lint | backend, frontend e extensão PASS; lint zero avisos | `.tmp/NA-0203/hardening-*-types.log`, `hardening-lint.log` |
| Build local extensão | `0.1.0`, build `e00c4a9a3155` | `.tmp/NA-0203/hardening-local-build.log` |
| Build frontend/bundle pós-remount | PASS;158 arquivos JS sem metadados proibidos pelo gate | `.tmp/NA-0203/manual-post-remount-{build,bundle}.log` |
| Manual pós-remount | Captura5, geometria60, dois ciclos tenant sem reconexão, Node3+Vitest18 e hashes5/5 PASS | `.tmp/NA-0203/hardening-manual-isolated-capture.log` e logs de revalidação |
| Sonar | BLOCKED no preflight, sem Quality Gate | `.tmp/NA-0203/hardening-sonar-remount.log` |
| Security scan final | PASS;43 fixtures revisadas,0 novas; Semgrep0 achados/0 erros/999 targets | `.tmp/NA-0203/hardening-security-final/scan-summary.json` |

Os74 opt-in da chamada integrada são72 SQL executados separadamente e2 harnesses HTTPS. O harness admin foi reexecutado nesta rodada; o cofre/terminal HTTPS anterior está registrado em test-results.md, e o terminal foi revalidado novamente via manual:capture. Não somar rodadas repetidas como casos novos. O build frontend mantém avisos de tamanho de chunks e anotação de dependência, sem alterar limites para ocultá-los.

## Invalidação persistente

Nova migração `20261124233000_vault_fill_generation`: geração global persistente, rotacionada ao iniciar a API mesmo com piloto desligado. Autorizar e consumir vinculam a operação à geração lida sob lock compartilhado na mesma transação. Operação anterior a restart/off-on não revive. Réplicas usam a geração corrente do banco, sem cache local; escalar/reiniciar invalida conservadoramente operações pendentes, exigindo novo clique. Alterações de configuração exigem reiniciar os serviços; desligamento só é efetivo em todo o ambiente após concluir o rollout de todas as instâncias.

Inicialização tem limite SQL (500ms para adquirir transação, 2500ms de execução) e barreira externa de 4000ms. Falha/timeout deixa preenchimento indisponível até reinício bem-sucedido, preservando as outras telas; conclusão tardia não reabilita a função. Operações já entregues ao site não são recuperadas retroativamente.

Baseline82 e pós-correções88 testes dirigidos PASS. Cobertura de runtime/fill: 22 testes, statements98,48%, branches95,65%, funções/linhas100%; não é cobertura global ou Quality Gate. SQL72 PASS, sem skips, incluindo os dois sentidos de corrida entre rotação e consumo, e operação nova aceita após rotação por outra instância. Evidência `.tmp/NA-0203/mysql-1795563039-ee5e5c/execution.json`, fingerprint `aa35ef2f176472e18c3915a42272aef8f4a76b3217c28c6b5c6c9bfb965320f6`, fontes estáveis e cleanuptrue. Primeiro ensaio falhou antes dos testes por engine Prisma root711; repetido com engine idêntico já legível em `@prisma/engines`, sem alterar permissões ou regenerar dependências.

## Volume e usabilidade

Fixtures: 2500 sites/5000 hosts, subconjuntos autorizados, 80ms de latência simulada. Encontrados e corrigidos retry que descartava páginas já carregadas e foco perdido ao criar/editar. Retry preserva cursor/páginas, nome recebe foco no editor e cancelamento/salvamento devolve foco à ação de novo item. Não houve redigitação da senha após erro local.

78 testes e22 checks de navegador PASS em `.tmp/NA-0203/sites-volume-report.json`; mediana342ms em cinco amostras da última tecla ao resultado, uma chamada por busca. Medições sintéticas, não benchmark MySQL nem estudo humano. Teclado/labels/360px verificados; não é auditoria completa de leitor de tela/WCAG. Captura mobile revisada pelo implementador principal. Harness mantido em `tools/vault-extension/sites-volume-smoke.cjs`, reexecutado com22 checks PASS em `.tmp/sites-volume/run-STOqXA/result.json`; fingerprint `b85076db7ecc2e6f64cfa6883c3c2e656519a731c3e7bf1c881be2ce19b34f99` estável e recalculado pelo revisor. Servidor próprio e portas limpos após execução; o resultado JSON antecede o cleanup, confirmado separadamente pelo término e inspeção do agente.

## Navegação do site para o terminal

O ensaio com serviços reais demonstrou falha que o teste isolado do conector não capturava: ao consumir `connect=1`, a chave `fullPath` do layout desmontava Hosts e invalidava a própria conexão antes de carregar o host. Baseline `.tmp/NA-0203/site-terminal-real/run-RZD8ns/result.json`, fontes estáveis e cleanup concluído. `hostRouteContentKey` agora remove somente esse parâmetro da chave de montagem da rota Hosts; a URL real continua consumindo a ação. Mudança de host, filtro, hash, rota ou identidade preserva as proteções existentes. Três testes adicionais,12 testes dirigidos e lint PASS; tipos frontend PASS. Revisão independente estática específica PASS, sem execução dos testes pelo revisor.

Após a correção, o ensaio completo PASS em `.tmp/NA-0203/site-terminal-real/run-4EBwIH/result.json`: 13 asserções (12 nomes únicos, sugestão de host repetida no cenário ACL), comando executado por OpenSSH e marcador lido diretamente no container, PTY remoto30×153 igual ao navegador. Voltar/recarregar não duplicou sessão; view-only, revogação, sessão expirada e invalidada bloquearam conexão nas janelas observadas. Fingerprint antes/depois `91054acdf5bc9f91d0c705c19aa6188aadef1d270f8cb4a9072bfccc029f39dc`, fontes estáveis e cleanup concluído. Captura `real-ssh-terminal.png` revista pelo principal: comando/resultado legíveis e terminal enquadrado.

API, gateway, senha+TOTP, DPoP, banco e OpenSSH reais; identidade/site sintéticos, enrollment da extensão semeado e TLS de fixture. Imagem runtime anterior recebeu dependências JS instaladas montadas somente para leitura, com versão por caminho comparada ao lock e hashes registrados; não é certificação da imagem empacotada. Schema histórico importado com registro explícito de baseline; sete migrações posteriores executadas realmente, guard de readiness preservado. Rodadas intermediárias de infraestrutura e prontidão do shell falharam e foram corrigidas no harness sem relaxar a prova de comando remoto. Revalidação do manual/terminal após o patch concluída PASS; tentativas intermediárias tiveram timeout de montagem e falha de import dinâmico, sem relaxamento das asserções.

## Central de Segurança

Causa reproduzida: catálogo com hashes stale em credentials/connections fazia o módulo virtual retornar500; falha do import dinâmico acionava recuperação do roteador e voltava a /hosts. Corrigido fallback seguro somente no servidor de desenvolvimento: Central permanece aberta, sem afirmações não revisadas. Build/export continuam estritos. Antes/depois `.tmp/NA0203/security-{before,after}/result.json`.

Revisão independente das alegações existentes autorizou atualização editorial, preservando `testsExecuted:false`, connections `partial` e limitações. Hash credentials `b2e83b3ede0be034e9551ce3d17442626ad574db8bdffe66a2414ab9fd4cf1dc`; connections `cf188b0be8eb25312f0b91040f19339193410960e5619ef58a293a4444970c87`. Base e working tree diferenciados no scope. Rerun com conteúdo completo PASS8 cenários em `.tmp/NA0203/security-final/report.json`; build frontend estrito PASS.

A inspeção global de bundle encontrou caminhos de código serializados pelo plugin do manual, não pela Central. Correção mínima com allowlist dos campos públicos; `loadManual` e hashes editoriais internos preservados. Teste Node3 PASS, revisão independente estática PASS e reconstrução/inspeção final dos158 arquivos JS PASS. Não foram identificados valores secretos nesses caminhos.

## Revelar/copiar no tenant

Administrador do tenant pode consultar a configuração; somente gestor do cofre propõe alteração e outro gestor aprova. Habilitar no tenant não substitui concessão ao usuário e liberação do item. Baseline Playwright confirmou administrador sem botão e gestor com ação. Orientação ajustada para explicar indicação por gestores existentes e configuração inicial dos dois gestores pelo responsável da instalação; nenhuma ACL ou regra de dupla aprovação alterada. Percurso integrado PASS14 cenários, incluindo administrador sem papel de gestor desktop/mobile, indicação por dois gestores, configuração, concessões e liberação/revelação do item. Rodadas anteriores tiveram timeout de montagem da tela, inclusive isolada; não atribuir causa definitiva à carga. Rodada final passou sem aumentar prazo ou relaxar asserções.

## Matriz e revisão final

- Matriz React/Vue/dinâmicos/ambiguidade e interrupções: 95 checks/21 cenários PASS (`.tmp/NA-0203/sites-browser/run-ovhdY6/result.json`), fingerprint `76b7476fda09257ee9968c2a544a3f4140f7948f6a0422bbd2aa4da913d0b4a0` estável e recalculado pelo revisor. Bugs React e resposta tardia após logout/troca de identidade corrigidos. Epoch local e snapshot de autorização bloqueiam envio tardio antes do despacho. Script já despachado não é recolhível. Pré-verificação lê estrutura, nunca valores; etapa somente de usuário é recusada antes de autorizar, mas etapa somente de senha com usuário cadastrado ainda é recusada após consumo. Não afirmar que todo formulário incompatível evita solicitação do segredo. Não há submissão nem retry de entrega implementados; repetição de transporte pelo navegador usa a mesma operação já consumida. Backend/terminal desta matriz são sintéticos, complementados pelo SQL e ensaio SSH separado.
- Revisão independente consolidada estática PASS_WITH_WARNINGS, sem bloqueio de código remanescente. Revisor conferiu artefatos e recalculou fingerprints declarados; não reexecutou testes. Não equivale a aprovação de release.
- Manual pós-remount PASS: cinco imagens revistas; aviso transitório na captura de tenants fica acima da tabela e não encobre procedimento. Houve `ERR_NETWORK_CHANGED` em módulos no ensaio isolado, com recuperação pelo fluxo existente; tentativas anteriores falharam por montagem/import e permanecem registradas. Não atribuir causa definitiva à aplicação ou ao ambiente sem prova. Só capítulo hosts teve hash editorial atualizado para `30c9dee8b5974938ff9f9a2e912e7320c21c6a61b1d12021925329e98bbd54d5`, após evidência; demais capítulos revalidados sem mudança de procedimento.
- Build/bundle pós-revisão editorial PASS,158 arquivos JS inspecionados (`manual-post-remount-{build,bundle}.log`); testes Node3+Vitest18 e cinco capítulos atuais (`manual-post-remount-{tests,reviewed}.log`). Sonar executado, BLOCKED no preflight; Windows Hello físico e pentest continuam gates externos. Roadmap Revisões44 atualizado em escrita única nesta interação, Original2027 e IDs preservados.

## Revisão individual de fixtures

Revisor independente confirmou que os valores sinalizados permanecem placeholders PEM com corpo `...` e chaves geradas em runtime no harness. Atualizados somente hashes, preservando regra/path/linha: en.json `private-key:1051` → `49bff0843942510d2de78a8399951be4232aea045fbe57d69cf56c8482a58a67`; pt-BR.json `private-key:1054` → `4a89108214df7405c229d2c1005bd197fd906d9acd94589d10fbbd40d220c436`; mysql-harness.py `generic-api-key:89` → `de3c36398de9d0f7ae4abb0e0d92542cf75daac5420dd5ce611bffa6fbfcb6dd`. Diferenças desta rodada: dois textos de orientação por idioma e inclusão da migração de geração persistente.

Novo achado no harness SSH revisado individualmente: `tools/vault-extension/site-terminal-real.mjs`, regra `generic-api-key`, linha228, hash integral `05438e0b0b914a739d446e3c58407847235daebaa982f345592596d62e988fb9`. Contém somente nomes públicos de migrações SQL, sem credencial. Scan intermediário falhou com42 fixtures e1 novo achado; autorização independente do hash/linha finais precedeu inclusão da43ª exceção estrita. Scan final PASS em2026-11-25T00:19:54.807Z,43 revisadas/0 novas, Semgrep0 achados/0 erros/999 targets. Nenhuma exclusão abrangente de regra ou redução de threshold.
