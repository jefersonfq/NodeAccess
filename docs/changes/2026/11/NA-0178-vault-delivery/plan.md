---
change_id: NA-0178
title: Sessão isolada e entrega cifrada por operação do VaultNAccess
type: security
status: closed
created_at: 2026-11-15T23:32:58-03:00
base_branch: master
base_sha: bf122f141029244b0687f549353d79b4dcbaa506
branch: security/NA-0178-20261115-vault-delivery
owner: unassigned
planner: Codex
risk: high
---

# NA-0178 — Sessão e entrega do VaultNAccess

## Contexto e situação anterior
Catálogo fase1A e contrato NA0177 integrados. Não há sessão própria nem extração de valores. Usuário autorizou implementar fim a fim os itens1/2 recomendados: sessão/permissões e entrega cifrada, antes da UI de revelação e extensão.

## Problema e objetivo
Implementar API, domínio, persistência aditiva, reautenticação e envelope padrão com auditoria atômica, sem dependência operacional nova em auth/SSH/RDP/terminal/snippets.

## Escopo
Portal autenticado como primeiro cliente. Instância emitida pelo servidor, vínculo revogável com refresh central validado apenas no backend, desafios únicos, senha NodeAccess+TOTP somente sob política local explícita; SSO sem prova elegível permanece negado. Política por tenant default-off, entitlements por ação sem admin bypass, elegibilidade web explícita default-false. Sessões30min/idle5min, freshness60s reveal/copy, grants30s, consumo único+auditoria SQL transacional, JWE RSA-OAEP-256/A256GCM via jose já presente. Rotas privadas HTTPS, schema estrito, limites e no-store. Testes de API/cripto/concorrência com dados descartáveis. Procedimento de configuração administrativa controlada e rollback.

Fora: UI reveal/copy, plugin/PKCE/DPoP, fill efetivo, WebAuthn/Windows Hello, bridge, E2EE, PEM/exportação. Não ativar produção ou declarar compatibilidade Windows. Contrato adaptado ao piloto portal/local; nenhuma extensão autorizada por este bootstrap. Entrega default-off até gates completos e habilitação explícita de tenant.

## Critérios de aceitação
- [x] Base atualizada, baseline e desenho revisado independentemente.
- [ ] Sessões/desafios vinculados a usuário/tenant/instância/origem, expiração e lock sem logout central.
- [ ] ACL/licença/entitlements/elegibilidade/prova fresca revalidados; falha fechada e sem autoelevação.
- [ ] Envelope padronizado de contexto imutável; nenhuma resposta plaintext ou dado sensível em logs/status.
- [ ] Consumo+auditoria atômicos; disputa20consumidores e revogação/rotação testadas no MySQL real.
- [ ] Logout da sessão central específica invalida novas entregas sem modificar seu fluxo.
- [ ] Migração aditiva, limites compartilhados, falhas de dependências e regressões demonstradas.
- [ ] Typecheck/lint/testes/Sonar, revisão independente e documentação/roadmap registrados.

## Estratégia técnica
Domínio/ports independentes de Fastify/ORM; adaptadores SQL, Redis de identidade, reautenticação local e jose. Política e sessão são autoridades server-side; lock não toca autenticação central. Consumir sob locks SQL em linhas autoritativas; checar referência Redis monotônica antes e após commit, negando payload se origem desapareceu. Sem alegar transação distribuída. Revisão do desenho e prova de corrida antes de habilitar.

## Riscos e mitigações
Extração de credenciais amplia superfície: default deny, licença, grant explícito e item web; não basta admin/proprietário. Recursos compartilhados competem: pool/quota limitados e timeout próprios. Refresh atual chega em body central: bootstrap portal recebe-o somente viaHTTPS e nunca retorna/guarda token; não copiar para extensão. SQL/Redis indisponíveis negam entrega. Valores já liberados não podem ser revogados retroativamente. Revisão deve verificar escritores/locks, não confiar só em versões ou eventos.

## Matriz de testes e evidências
Baseline auth/current-session/secrets/snippets; unidades de política/expiração/replay/tampering; API viaFastify com dependências controladas; MySQL/Redis descartáveis para migração, concorrência, auditoria, rotação/ACL/logout; JWE interoperável; regressões centrais. npm run validate:sonar obrigatório. UI/PTY apenas se área útil/transporte forem alterados; não previstos.

## Baseline
SHA bf122f141029244b0687f549353d79b4dcbaa506, master limpa e fetch conferidos. Baseline executada: 48 testes em quatro suites auth/current-session/refresh/Secrets, zero falhas. Contrato NA0177 e auth/Secrets reais inspecionados; jose já dependência do backend.

## Rollback ou recuperação
Desligar política de entrega, invalidar clientes/sessões/grants; reverter módulo e registro de rotas. Migração somente aditiva, sem alterar ciphertext operacional. Não remover auditoria ao reverter, nem restaurar banco como rollback automático.

## Aprovação
- Decisão: GO_WITH_RISKS, condicionado à revisão das barreiras e baseline antes de código.
- Aprovado por: usuário, implementação fim a fim dos itens1/2 nesta interação.
- Aprovado em: 2026-11-15T23:32:58-03:00
- Publicação/merge e homologação não são presumidos por validação local; autoridade da sessão será aplicada ao finalizar resultado concreto.

## Decisões de implementação
Revisão independente GO_WITH_RISKS: locks autoritativos SQL, snapshot completo e rechecagem Redis pós-commit; nenhuma escrita reutiliza jti. Bootstrap portal-only exige senha local+TOTP sob política explícita; WebAuthn não é pré-requisito deste fallback já previsto no contrato. Trials e login externo não habilitados neste piloto; negar explicitamente. Correção necessária: logout não deve ocultar falha Redis como JWT inválido; sem nova dependência de autenticação. Recuperação Redis que ressuscite sessões exige revogação administrativa antes de reativar delivery. Configuração administrativa controlada exige dois responsáveis distintos do beneficiário; sem autoelevação por role/propriedade.

## Adequações verificadas do contrato
API é portal/local, não handoff de extensão. POST/status mantém IDs fora da URL; REQUESTED→AUTHORIZED é uma só chamada quando a prova deunlock já é fresca, sem challengeopredundante. Auditoria é ledgerSQLdurável transacional, sem outboxnecessário para confirmar. Managers optin têmduplaaprovação e nãoentitlementimplícito; todaalteração incrementageração. Rechecagemfinaladmin dentrotx define pontoautorização; rechecagemdelivery póscommit define emissão. Licença active/expiry é autoridade e seu vencimento limita grant/response. Manual de uso não muda: nenhuma tela, área útil, websocket ou transporte é alterado; correção logout refere-se ao erro de armazenamento.

## Correção necessária na publicação — 2026-11-16

PR68 contém o candidato 8fca07200, com gate integral local PASS e aceite humano para integração do backend default-off, sem deploy/ativação. Usuário autorizou publicação e continuidade dos itens 1/2/3; frontend pertence à NA-0179. A falha remota static-and-secrets (run 43864490820/job 133289420631) requer somente revalidar duas fixtures por regra/linha/hash: constante sintética intacta em logger.test.ts:8 e referência a variáveis aleatórias no harness MySQL:82. Revisão independente confirmou ausência de segredo real nas ocorrências. Não alterar scanners, exclusões, regras ou thresholds. A correção e atualização deste registro são IN_PLAN como compatibilização dos gates; novo SHA exige nova validação, revisão e checks antes de merge. Aceite humano não se estende a UI/Windows Hello nem autoriza deploy. Worktree isolado preserva alterações frontend; apenas documentos desta frente serão sincronizados posteriormente.

## Adequação do harness SFTP na validação final

Correção IN_PLAN autorizada para delimitar a medição de invalidação após o prefetch confirmado e antes do Enter no harness, sem alterar produto, cache, debounce ou assertiva de exatamente uma nova listagem. O fixture registrará path/prefix/directoriesOnly e aguardará um prefetch conhecido antes de enviar o comando, tornando a regressão determinística. Baseline anterior permanece validando reuso exclusivo do canal SFTP. Manter teste negativo de duplicação. Revisão independente antes de commit; ensaio Chromium e novo gate integral no SHA final são obrigatórios antes de prontidão. Nenhuma mudança de escopo do roadmap.

## Revalidação exata das revisões de fonte

Após o harness mudar, revalidar somente sourceSha256 de SQ-0437/SQ-0438/SQ-0439, ocorrências S1313 de IPs sintéticos intactos em FakeWebSocket. Revisão independente aprovou contexto e identidade das três ocorrências. Não alterar regras, assinaturas, ranges, racionales, accepted-findings ou thresholds. Necessidade revelada por REVIEW_SOURCE_CHANGED nos gates local/remoto de c3e754dd0; novo candidato exige gates completos antes de merge.
