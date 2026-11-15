---
change_id: NA-0174
title: Corrigir controles reproduzidos e concluir matriz focal de segurança
type: security
status: in-homologation
created_at: 2026-11-14T21:31:28-03:00
base_branch: master
base_sha: 28685c5b2c3fbf9739a05629260c95e42e0d62d0
branch: security/NA-0174-20261114-security-diagnosis
owner: Codex
planner: Codex
risk: high (correções focais de autenticação e transporte)
---

# NA-0174 — Diagnóstico aprofundado

## Aprovação

O escopo somente leitura abaixo foi ampliado pelo pedido de concluir pendências em
15/11; o contrato vigente está em “Correções autorizadas” e no critério de encerramento
técnico ao final. PR63 já integrada; PR64 contém o candidato de controles, ainda sem merge.

Decisão: GO_WITH_RISKS para diagnóstico inicial somente leitura; reproduções e correções futuras dependem de plano específico.
Usuário autorizou fechar a Central e iniciar diagnóstico aprofundado em 14/11/2026.
Escopo inicial aprovado: inspeção de código, mapa de fronteiras, matriz de evidências e
backlog de testes por risco. Não autoriza mudar autenticação/SSH nem testar produção.
Na abertura, a base era o commit local da Central; a implementação atual usa master28685c5b2 após integração da PR63.
Origin/master consultado em 14/11: 745253d1edb522db79aaa44fd96608ce434a2774.

## Escopo
- Mapear navegador/API/WebSocket/gateway/hosts, dados de tenants, Cofre e saídas HTTP.
- Registrar evidência por arquivo/linha, teste existente e lacuna; hipótese não é achado confirmado.
- Investigar prioridade inicial: isolamento entre tenants, revogação de sessão/ACL, host keys,
  credenciais e política de egress. Preservar acesso legítimo às redes privadas dos hosts.
- Distinguir testes herdados da Central de testes executados especificamente para o diagnóstico.
- Revisão independente focal das conclusões; correções e laboratórios exigem plano subsequente.

## Estratégia técnica
Leitura focal em duas trilhas: autenticação/tenant/Cofre/HTTP; revisão independente de host keys
e revogação por protocolo. Criar matriz de cenários negativos e decisões necessárias antes de
probes ou patches. Sem segredos, dados pessoais, configuração de produção ou topologia real.
Não há dependência nova nem alteração de runtime. Novas evidências podem alterar prioridades.

## Matriz de testes e evidências
Ran: inspeção e verificação de base/branch. Planejado: revisão dos documentos e rastreabilidade.
Baseline de cinco suítes/50 contratos existentes executada no checkout NA-0172 do mesmo SHA: PASS. Não reproduz hipóteses novas nem equivale a pentest; ver evidence/baseline.json.
Rollback documental: remover/reverter apenas arquivos desta frente. Sem migração ou deploy.

## Contexto e situação anterior
Inventário focal da NA-0172 descreve controles disponíveis, mas não cobre todos os caminhos
nem substitui avaliação das fronteiras de confiança. O plano v2 prevê aprofundar essa análise.

## Problema e objetivo
Identificar diferenças de política e lacunas de evidência por protocolo antes de propor controles
novos. Entregar mapa, observações rastreáveis e cenários capazes de confirmar/refutar hipóteses.

## Critérios de aceitação
- [x] Mapa inicial de fronteiras e observações com fontes: registrado em diagnosis.md.
- [x] Distinção entre fato observado, hipótese e falha demonstrada: explícita por cenário.
- [x] Baseline e limites de execução: evidence/baseline.json; cinco suítes/50 testes existentes.
- [x] Revisão independente focal: concluída com avisos documentais corrigidos.
- [ ] Reproduções e diagnóstico completo de todos os protocolos: pendentes; não declarar auditoria concluída.

## Riscos e mitigações
Leitura parcial pode gerar falso positivo: exigir reprodução e examinar caminhos alternativos.
Não modificar controles críticos, coletar segredos ou usar destinos reais nesta etapa inicial.

## Baseline
Código e83fdc5bac00c3ef72b19b18169941d2d3f67fc8; branch derivada do candidato da Central,
não de uma entrega presumida. Testes de baseline rodados no checkout NA-0172 do mesmo SHA.

## Rollback ou recuperação
Reverter somente documentos desta frente; não há código, migração ou configuração alterados.
Preservar cópias canônicas e evidências. Não desfazer alterações do usuário em outras frentes.

## Evidência adicional de fechamento

D-13 registra bloqueio real do scanner de imagens da PR63. Primeiro inventariar versões,
origens e aplicabilidade; correções multicomponente devem ter escopo e matriz próprios,
revisão independente e gates completos. Não renovar triagens vencidas sem nova evidência.

## Continuação autorizada — 2026-11-14T22:27:57-03:00

Usuário: “vamos em frente com o gate e os cenarios fim a fim”. GO_WITH_RISKS para
Reproduções locais descartáveis dos cenários D01/D02, D06/D07/D08/D12 com controles positivos/negativos. Distinguir integração de serviço de ponta a ponta de aplicação; sem produção ou credenciais reais.

Aceite: evidência por achado/pacote, imagens identificadas por digest/ID, revisão independente,
regressões pertinentes e validate:sonar para código alterado; nenhum merge com gate aberto.
Risco: atualizações de bibliotecas podem afetar TLS/guacd/CLI. Mitigar por build, inventário,
scanner atual e cenários reais antes de commit/integração. Rollback: reverter apenas a correção
da frente, sem alterar ambiente em uso. Plano anterior descreve etapas históricas.

## Estado do gate — 2026-11-14T23:23:51-03:00

LOCAL_WIP. Evidências finais desta rodada na NA-0172/evidence/gate-progress-20261114.json.
Sonar Quality Gate OK, validação integral bloqueada por reconciliação do checkout.
Imagens5/7 PASS; triagens pendentes de autorização e atualização MySQL sem build concluído.
Reproduções NA-0174 com limitações concluídas; correções dos controles ainda pendentes.

## Estado após fechamento da Central — 2026-11-15T13:24:26-03:00

D-13 tratado; PR63 integrada, gate completo e master sincronizada. Demais hipóteses e
correções de controles continuam no escopo do diagnóstico, sem patch aplicado. Próxima
implementação requer contrato/aceitação claros e atualização da base para master integrada.

## Correções autorizadas — 2026-11-15T14:15:46-03:00

Pedido: realizar pendências para concluir Central e derivados. Ampliação autorizada pelo
usuário nesta interação; planejamento independente GO_WITH_RISKS. Base integrada master28685c5b2.
Checkout isolado preserva trabalho independente do canônico. Restrições somente leitura acima
registram etapas históricas e não limitam este incremento.

### Contratos e aceite
- [x] D01/D02: REST e novas admissões rejeitam usuário inativo, versão revogada ou privilégios
  divergentes; logout-all invalida tokens anteriores e fecha sessões autenticadas por evento.
  Mudança efetiva de privilégios incrementa versão atomicamente; preservar delegação plataforma
  autorizada e saída segura. Falha de consulta não amplia autorização. Sem consulta por byte.
- [x] D07/D08/D09: validar fingerprint alvo/bastion em SFTP/SSH/túneis; divergência rejeitada
  antes de autenticar. Preservar política existente de primeira confiança. Bastion sem fonte
  confiável exige regularização explícita, nunca confiança silenciosa.
- [x] D06: sessões nativas no registry compartilhado; revogação fecha transporte, remove handle,
  preserva motivo e revalida ACL durante abertura. Canal fechado durante abertura não fica órfão.
- [x] D12: negativo de não proprietário não prevalece sobre positivo; correlacionar request e
  sessionId; timeout/falha permanece não confirmado. Teste com Redis real e sessões concorrentes.
- [x] D03/D04/D05/D10/D11: matriz focal tenant/segredo/egress/auditoria/ACL com controles positivos
  e negativos; corrigir falhas demonstradas. Revogação impede novas operações; explicitar
  contrato de transferência em andamento conforme infraestrutura existente antes de concluir.
- [x] Corrigir omissão de security-center no relatório sanitizado CI sem relaxar filtros/gates.
- [x] Revalidar manual para fluxos afetados; catálogo deve refletir limites da evidência.
- [ ] Baseline, regressões focais, transporte real/PTY, validate:sonar integral e revisão
  independente; publicação segue gates lifecycle e autorização existente.

Sem alteração de versão guacd, produção, dados reais ou ampliação de exceções. Sem migração
planejada/dependência nova. Riscos: consultas na admissão, negação de tokens antigos e término
de canais; validar positivos/isolamento/concorrência/falhas. Rollback: reverter patch, sem dados.
Conclusão refere matriz focal registrada, nunca certificação universal de segurança.

## Critério de encerramento técnico da matriz

A matriz focal usa evidência real para HTTP/auth, MySQL/ACL/Cofre, SSH/SFTP/Redis e PTY
com aplicação completa. RDP/VNC e TELNET têm contratos de revogação e concorrência; wire
gráfico real, auditoria universal, transporte de todos os agentes e produção não são
certificados por este incremento. Preservar essa distinção em entrega e homologação.
Redis indisponível ou evento perdido pode deixar encerramento físico sem confirmação,
mesmo com token revogado; evento tardio pode fechar recurso novo. Não há fila durável nova.

## Resultado técnico final — 2026-11-15T16:05:54-03:00

Candidato `15938ada5b1a62e54870bfe50411bbce9f0a4f41`, PR64 pronto para revisão; Sonar local/remoto,
CI de controles, upgrade/restore e imagens7/7 PASS. A matriz focal foi implementada e
validada nos limites definidos neste plano. Homologação humana e integração pendentes;
cenários RDP/VNC wire real e garantia durável de eventos continuam fora da comprovação.
Ver implementation.md, homologation.md e evidence/controls-final-20261115.json.
