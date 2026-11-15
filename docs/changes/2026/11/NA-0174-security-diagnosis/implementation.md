# Registro de implementação — NA-0174

Base SHA: 28685c5b2c3fbf9739a05629260c95e42e0d62d0 (diagnóstico original e83fdc5b)

## Resumo atual

Candidato ce7a31fda publicado no PR64 (draft); base master28685c5b2. Controles
D01/D02/D06/D07/D08/D09/D11/D12 corrigidos; D03/D04/D05/D10 validados nos limites registrados.
HTTP/MySQL/SSH/SFTP/Redis reais, CAS concorrente e PTY fullapp/top/htop PASS.
Revisão independente PASS_WITH_WARNINGS. Manual/capturas/catálogo revalidados.
CI de upgrade/restore/runtime/imagens PASS (7/7); estática/segredos e governança PASS.
Sonar local ce7a31fda FAIL: zero violações novas/hotspots, cobertura76,2% (<80%),
coleta Node afetada por PATH e teste browser com data antiga. Não considerar entregue.
Correções focais validadas: PATH limpo, data derivada do catálogo, laboratórios loopback SSH/SFTP
incluídos na coleta Vitest local/CI e testes observáveis do repositório de usuários.

Guacd1.6.0 e imagens de produto preservados; sem migração/dependência nova. Limites: Redis
pubsub não durável, evento tardio pode encerrar reconexão válida, RDP/VNC sem wire real.
Nenhuma implantação ou homologação humana presumida. Evidência: evidence/controls-validation-20261115.json.

## Pedido e objetivo

Iniciar diagnóstico aprofundado após a Central, com evidências e testes discriminantes antes
de alterar controles críticos. Pedido autorizado em 14/11/2026; escopo inicial somente leitura.

## Implementação

Ver plano vigente e diff da branch. Reutilizados sessionVersion, registries e eventos;
sem migração ou dependência nova. Ingresso consulta estado atual, revogação cancela canais
conhecidos; verificação de fingerprint é obrigatória para alvo e salto. Bastion legado sem
Host de origem exige regularização. Arquivo SFTP parcial não tem rollback automático.

## Validação

Ran: baseline, focais e laboratórios descritos no resumo/evidência; falhas iniciais preservadas.
Planned: repetir cobertura/Sonar e CI no SHA corrigido; preservar resultados anteriores.
Skipped: produção e sessões RDP/VNC reais; testes de contrato não substituem esses ensaios.
Manual: homologação funcional do usuário ainda não executada nesta frente.

## Recuperação

Reverter somente patch NA-0174; sem migração/alteração de dados existentes. Recursos usados
nos laboratórios são descartáveis; cleanup registrado. Preservar demais frentes canônicas.

## Pendências

Concluir correções do gate, validate:sonar integral no SHA final e checks/revisão remotos antes
de entrega pelos gates. Roadmap será atualizado em uma única escrita ao fechar a rodada.

## Diário de interações

### 2026-11-15T13:24:26-03:00 — D-13 encerrado; controles permanecem pendentes

Ran: CI final8d668889 aprovou imagens7/7, MySQLfreshbuild, stack/TLS/restore e Sonar.
PR63 integrada e master sincronizada28685c5b2; nenhum deploy. Triagens cinco até29/11,
SQLite18/11. Sem patch de controles; reproduções/limitações anteriores preservadas.
Roadmap atualizado em escrita agrupada desta interação. Próximo: contrato de logout-all,
identidade SSH e revogação, com plano próprio e base integrada.


### 2026-11-15T12:15:39-03:00 — D-13: imagens corrigidas e validação real

Usuário autorizou cinco triagens e correção MySQL, preservando versão guacd e permitindo
correção de bibliotecas. NA-0172 mantém guacd1.6.0;7/7 scans PASS com DB15/11, MySQL
libbrotli1.0.9-10.0.1 por download oficial/assinatura/checksum. Stack e upgrade/restore
PASS; sem produção. Update integral MySQL usou camada cacheada, RPM amd64. Primeiro
Sonar falhou HA; ensaios focados passaram sem mudanças, repetição integral em andamento.
D-01/D-02/D-06/D-07/D-08/D-12 continuam reproduzidos com limitações, sem patch de controles.
Evidência vinculada à NA-0172/evidence/gate-authorized-20261115.json.


### 2026-11-14T23:23:51-03:00 — Gate e cenários fim a fim consolidados

Pedido: avançar gate e cenários. Corrigidas imagens na NA-0172 isolada; catálogo de permissões
passou a partial. Integrações de stack, TLS, nonroot e guacd SSH/VNC PASS. Diagnóstico reproduziu
tokens antigos após mudanças de estado, identidade SFTP/bastion e revogação nativa; limites
de adapters e topologia estão no diagnosis.md. RDP, UI completa do diagnóstico e produção não
validados. Sem patch de auth/SSH. Sonar final: gate OK,80,8%; validação integral FAIL apenas
por REVIEW_CHECKOUT_CHANGED. Imagens5/7 PASS, sete achados bloqueantes restantes. Oracle
falhou em metadados/download; última tentativa incompleta, sem sucesso inferido. Auto-review
recusou renovação de cinco triagens até29/11 por alterar exceções sem autorização específica;
proposta reviewável e pergunta pendentes, sem aplicação. Nenhum novo commit/push/merge/deploy.
Roadmap META-051/META-054 atualizado uma vez; Original2027 preservado. Próximo: decisão sobre
triagens, concluir atualização MySQL, estabilizar checkout e repetir gate integral antes de CI.


### 2026-11-14T23:07:06-03:00 — Reproduções e gates locais

Ran: dez cenários SSH/SFTP/revogação, três mutações HTTP com login real e banco/Redis,
smokes guacd SSH/VNC (frame zlib com1024pixels conferidos). Fontes0b68abaf verificadas;
limpeza registrada. Revisão independente confirma inferências limitadas, sem app/UI completos.
Token antigo conserva autorização no endpoint testado após mutações; SFTP aceita chave
incompatível; sessão nativa aceita comando após revogação; D-12 é ACK incorreto apesar de fechamento.
Central ajustada editorialmente para permissions:partial. Gate: cinco de sete imagens aprovadas
nos scans atuais; MySQL e guacd ainda bloqueados. Políticas não alteradas: auto-review rejeitou
renovação, autorização específica solicitada e ainda pendente. Oracle metadata indisponível;
sem exceção para libbrotli. Ran: stack real/semroot/TLS PASS. Sonar teve rodada falha; repetição
com grupo Docker está em curso. Próximo: concluir qualidade, autorização de triagem e pacote
MySQL; depois plano de correções de controles reproduzidos, com regressões próprias.

### 2026-11-14T22:27:57-03:00 — Gate e cenários autorizados

Retomado head0b68abaf da Central, PR63 draft e gate de imagens FAIL. Usuário autorizou
tratar gate e executar cenários fim a fim. Plano ampliado com escopo mínimo, laboratório
descartável e revisão independente. Diagnóstico inicial preservado; nenhum resultado novo
ainda inferido. Próximo: corrigir/triagar imagens e reproduzir controles com dados sintéticos.

### 2026-11-14T22:23:12-03:00 — Evidência do gate de imagens

Acrescentado D-13: oito achados bloqueantes em quatro imagens no CI da Central; cinco
triagens expiradas em08/11 e três achados não cobertos. Copiados resumo sanitizado do scan
e inventário de bloqueios, com SHA/run/hash. Consultadas fontes Alpine/Oracle; Go inacessível.
Nenhuma alteração de runtime/política, renovação de exceções ou exploração demonstrada.
Próximo: corrigir/triagar D-13 com evidência independente, depois testes de host key/revogação.
Roadmap atualizado uma vez nesta interação para Central bloqueada e diagnóstico iniciado.

### 2026-11-14T21:31:28-03:00 — Início autorizado
Usuário pediu fechar Central e iniciar diagnóstico aprofundado. Criada branch própria após
verificar ausência de colisão do ID e base remota. Plano acima delimita leitura e critérios.
Inspecionados guard JWT, acesso ao Cofre e proteção SSRF; revisão independente focal de
host keys/revogação iniciada. Ran: leituras; testes específicos e probes não executados.
Próximo: consolidar mapa, evidências e matriz de cenários, distinguindo desconhecido de falha.

### 2026-11-14T21:35:17-03:00 — Diagnóstico inicial consolidado

Registradas 12 observações e matriz de cenários negativos em diagnosis.md; revisão independente
de host keys/revogação e revisão documental PASS_WITH_WARNINGS. Avisos de referências/estado
corrigidos. Ran: cinco suítes/50 contratos existentes PASS no checkout NA-0172 do mesmo SHA,
sem mudança de código. Não são reproduções de novas hipóteses. Priorizar SFTP/bastion, revogação
nativa/distribuída e token de acesso antigo em laboratório descartável. Sem vulnerabilidade
explorável confirmada, sem probe ativo, produção, novos controles ou patch de autenticação/SSH.

### 2026-11-14T21:56:16-03:00 — Ensaio isolado do guard

Ran: quatro cenários com JWT/guards reais em rota em memória; sem servidor externo, estado
produtivo ou mudanças no produto. Confirmação limitada registrada em diagnosis.md e
evidence/guard-scope.json; não classificada como vulnerabilidade explorável. Fonte guard/trial
idêntica à base da frente; executado no checkout atualizado da Central. Primeira tentativa
inconclusiva por import do harness preservada; repetição4PASS. Próximo: revisão independente
do limite da inferência e posterior teste integrado de revogação real.

### 2026-11-15T14:15:46-03:00 — Fechamento dos derivados autorizado

Base isolada atualizada por fast-forward; documentos preservados. Contratos/matriz ampliada
registrados; planejamento independente GO_WITH_RISKS. Baseline em preparação; sem código
alterado nesta etapa. Próximo: correções, regressões, laboratórios/Sonar e revisão independente.

### 2026-11-15T14:42:30-03:00 — Correções e validações integradas

Aplicados controles e testes acima. Baseline93PASS; HTTP antigo401, novo login legítimo,
CASconcorrente1sucesso/1negado; SSHnativo fecha e10/10ACK distribuídos; PTYfullappPASS.
Primeira suíte integral93falhas; fixtures atualizadas mantendo guardreal/negativos. Lint em
correção. Capturas/manual validados; no runtime gráfico testes com transportes injetados.
Nenhum commit/push/merge/deploy da NA-0174. Próximo: concluir gates e registro do roadmap.

### 2026-11-15T14:47:13-03:00 — Candidato revisado

Suíte completa3739PASS,145opcionais nãoexecutados;27focais após versão malformada rejeitada.
Lint e27Node editoriais PASS. Revisão focal sem bloqueio, com limitesdocumentados. Catálogo
interno revisto por hashes; estados/publicações intactos. Sonar/CI ainda pendentes.
Próximo: scanner, commit autorizado e gates sobre SHA imutável.

### 2026-11-15T14:54:51-03:00 — Scanner final aprovado; commit autorizado

Ran: security:scan PASS,40fixtures previamente conhecidas/0não revisadas, Semgrep0.
Duas constantes de teste explicitadas como sintéticas; hashes documentais tipados como
digests com valores preservados. Políticas/allowlists intactas. Tentativas anteriores
FAIL preservadas nos logs privados. Revisão independente confirmou semântica/documentos.
Próximo: commit rastreável e validate:sonar integral no SHA limpo; sem entrega presumida.

### 2026-11-15T15:12:39-03:00 — PR64 e correção do gate

Pedido mantido: concluir Central e derivados. PR64 publicado em ce7a31fda; sem merge/deploy.
Ran: validate:sonar FAIL rastreável (76,2%, sem novas violações); upgrade/restore e scanner7/7
PASS no CI. Coletor ajustado sem baixar thresholds;34 testes do coletor e13 testes novos
do repositório PASS. Homologação humana permanece pendente. Próximo: validar candidato corrigido.

### 2026-11-15T15:23:51-03:00 — Fixture TLS e cobertura

Ran: Vitest integral3782PASS/0FAIL/124skipped; coletor34PASS; revisão focal81PASS/lint.
Node693PASS/1FAIL/11skipped revelou live.mjs sem reader atual; corrigido com usuários reais
distintos e claims persistidas. TLS focal3PASS,608requests,live/health/soak/watchdog e cleanup
PASS. Coleta anterior invalidada também por edição de fonte durante browser;84,4% é apenas
diagnóstico, não aprovação. Navegador repetido congelado; Sonar/CI do próximo SHA pendentes.

Browser congelado:10/10 harnesses PASS; manual reviewed e catálogo PASS. Commit corretivo
preparado; Sonar integral/CI do novo SHA ainda obrigatórios, sem homologação presumida.

### 2026-11-15T15:41:58-03:00 — Correção de governança do commit

CI f53c175 reprovou metadados: título da seção Aprovação e trailers obrigatórios.
Restaurado o título e acrescentados Plan/Change-Date/Tests/Evidence ao último commit
da própria branch. Sem mudança de runtime/testes ou regras. Lease exige head remoto
f53c175, impedindo sobrescrever avanço alheio. Sonar desse SHA: True;
resultado preservado. Novo SHA exigirá Sonar/CI completos; homologação pendente.
