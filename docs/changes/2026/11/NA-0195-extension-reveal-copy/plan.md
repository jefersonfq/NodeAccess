---
change_id: NA-0195
title: Extensão VaultNAccess E2 — revelar e copiar senha na extensão
type: security
status: ready-for-review
created_at: 2026-11-23T18:40:00-03:00
base_branch: master
base_sha: fa757ac8200ac7f5058a6da04f9eac6e4186e049
branch: security/NA-0195-20261123-extension-reveal-copy
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0195 — Revelar e copiar senha na extensão (E2)

## Contexto e situação anterior

A extensão (E1, NA-0183/0192/0193) só busca metadados e abre o item no portal; revelar e copiar existem só no portal (NA-0178/0179), com permissões por ação aprovadas por dois gestores, item liberado para entrega, política do tenant, prova recente (NA-0186), JWE para chave efêmera e auditoria. Plano de evolução: E2 depois da E6 (NA-0194).

## Problema e objetivo

Revelar e copiar Secrets direto do popup, com as mesmas regras do portal e sem trazer a senha central para a extensão (contrato §4).

## Escopo

- Backend (DPoP + autorização da extensão):
  - `POST /extension/unlock {otp}`: código TOTP do NodeAccess; grava a prova na autorização; vale o tempo de confirmação do tenant para revelar/copiar (60–900 s); limite 5/5 min; erro gravado antes da recusa; auditoria `EXTENSION_UNLOCKED`/`EXTENSION_UNLOCK_DENIED`.
  - `POST /extension/deliver {secretId, action, recipient}`: admissão com os limites do portal (`operations`, `tenant:operations`) gravada à parte; valida a chave do destinatário; exige prova dentro da janela (`423 VAULT_STEP_UP_REQUIRED`); `tx.secret` (política, permissão da ação por dois gestores, item liberado, escopo/ACL); JWE RSA-OAEP-256/A256GCM com contexto (operação, item, ação, chave, versões, validade 30 s, origem); auditoria `DELIVERY_RELEASE_COMMITTED` com o dispositivo; recusa de item = `403 EXTENSION_ITEM_DENIED` sem derrubar a autorização.
  - `capabilities`: `features.reveal/copy` pela política e pela permissão do próprio usuário; `proofUntil` quando há prova válida.
  - A prova não sobrevive a uma autorização renovada (NA-0193).
- Extensão: botões **Revelar senha**/**Copiar senha** nos Secrets; código do autenticador quando não há prova válida; chave RSA-OAEP efêmera não exportável e decifragem com WebCrypto (sem dependência nova), conferindo o contexto; valor só em memória, some em 15 s ou com **Ocultar**; cópia com segundo gesto (**Confirmar cópia**) e aviso de gerenciar a área de transferência; erros explicados.
- Docs: contrato NA-0177, operação, manual, plano de evolução.

Fora: preencher em páginas (E7), Windows Hello (E5), limpeza automática da área de transferência (exige permissão nova `offscreen`/`clipboardWrite`; o portal também não limpa).

## Critérios de aceitação

- [x] Sem código válido, revelar/copiar pedem o código; código errado é recusado, contado e auditado.
- [x] Com código válido, a entrega só acontece com política, permissão da ação aprovada por dois gestores, item liberado e escopo — as mesmas regras do portal — e é auditada.
- [x] O valor chega cifrado para uma chave efêmera do popup, ligado ao item/ação/chave; nada é gravado em armazenamento da extensão ou na auditoria.
- [x] Revelar mostra o valor e o esconde em 15 s; copiar exige um segundo clique e grava na área de transferência.
- [x] Recusa de item não derruba a conexão; limites do portal valem.

## Estratégia técnica

Reaproveita `tx.secret` e o `JweVaultEnvelope` do portal; a autenticação DPoP passa a ser verificada uma vez por requisição (`authenticate`) e as transações com a autorização (`inAccess`) podem ser várias (admissão e entrega). Prova guardada como `proofAt` no registro da autorização.

## Riscos e mitigações

- Valor de senha no popup da extensão: mitigado por prova recente (código), chave efêmera não exportável, contexto conferido, memória apenas, ocultação automática e segundo gesto para copiar; mesmo modelo de ameaça residual do portal (navegador comprometido).
- Código sem senha: decisão já registrada na NA-0193 (dois fatores de posse: chave do dispositivo + autenticador); 5 tentativas por 5 min.

## Matriz de testes e evidências

vitest `vault-security` e `apps/extension` (envelope com JWE real); MySQL real (valor real cifrado, permissão, item, auditoria sem o valor); `test:extension:web` (revelar e copiar no Chromium real com JWE real e área de transferência); `tsc`, `typecheck:extension`, `lint:changed`, `security:scan`, `manual:check-reviewed`; revisão independente de segurança; `validate:sonar` depende dos tokens do responsável.

## Baseline

2026-11-23, `fa757ac82` + NA-0194: vitest `vault-security` 308 PASS; `apps/extension` 44 PASS.

## Rollback ou recuperação

Revert da PR; sem migração. Para desligar sem deploy: política do tenant (reveal/copy) ou retirar as permissões pelos gestores.

## Mudanças de escopo e decisões

- 2026-11-23 (revisão independente, PASS_WITH_WARNINGS): erros do código para revelar passam a contar com a confiança do dispositivo (5º erro encerra confiança e autorização); validade da entrega limitada também pela janela da prova; extensão confere validade (relógio do servidor) e origem do contexto; cópia pendente expira em 15 s; memória limpa em falha; respostas tardias descartadas; regra de TOTP do contrato com referência à exceção.

- 2026-11-23 (pedido do responsável): o rodapé do popup conectado mostra a identificação do dispositivo no mesmo formato de **Dispositivos conectados** do portal (NA-0196), para revogar sabendo qual navegador; o texto antigo "Valores secretos ficam no portal" deixou de valer com a E2 e foi trocado por um texto neutro.

## Aprovação

Decisão: `GO_WITH_RISKS` — responsável aprovou E6 e E2 de ponta a ponta em 2026-11-23. Risco: valores de senha passam a ser exibidos também na extensão.
