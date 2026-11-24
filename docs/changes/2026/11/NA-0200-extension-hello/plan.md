---
change_id: NA-0200
title: Extensão E5b — confirmar com Windows Hello pela aba do portal
type: security
status: ready-for-review
created_at: 2026-11-24T12:45:00-03:00
base_branch: master
base_sha: 930004d4d00d30291a5c19b8b3f83fae791e8e2a
branch: security/NA-0200-20261124-extension-hello
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0200 — Windows Hello para a extensão (E5b)

## Contexto e situação anterior

Revelar/copiar na extensão (E2, NA-0195) exige o código do autenticador digitado no popup. O Windows Hello (E5a, NA-0198) destrava o cofre no portal, mas WebAuthn só roda na origem do portal; o popup (origem `chrome-extension://`) não pode usá-lo. O contrato (NA-0177 §11) prevê o ensaio SEC-16: popup → aba de consentimento → retorno ao popup ativo, sem laço de cancelamento e sem aceitar retorno de worker perdido.

## Problema e objetivo

Permitir que a prova recente da extensão venha da confirmação de identidade no portal (Windows Hello, ou senha + código), como alternativa ao código digitado no popup, sem levar senha, código ou token da extensão para outro lugar.

## Escopo

- Backend (rotas da extensão):
  - `POST /extension/proof-request` (DPoP): cria um pedido opaco de 2 min ligado à chave do dispositivo e ao usuário; limite próprio; devolve o pedido e o endereço da página do portal.
  - `POST /extension/proof-info` (portal, sem sessão do cofre): identificação do dispositivo e validade do pedido, para a página mostrar o que está sendo aprovado.
  - `POST /extension/proof-approve` (portal, sessão do cofre confirmada há menos de 60 s): marca o pedido como aprovado; auditoria `EXTENSION_PROOF_APPROVED`.
  - `POST /extension/proof-claim` (DPoP): só a mesma chave resgata o pedido aprovado e não vencido; grava a prova (`proofAt`) na autorização dela e apaga o pedido; pendente responde sem mudar nada.
  - O pedido não contém token nem segredo; fica em `vault_records` do próprio usuário.
- Portal: página `/vault/extension/confirm?request=…` com a identificação do dispositivo e a confirmação de identidade do cofre (Windows Hello quando cadastrado; senha + código; provedor OIDC/Google), depois "pode voltar para a extensão".
- Extensão: na prova de revelar/copiar, **Confirmar no portal (Windows Hello)** ao lado do código; abre a aba, aguarda a aprovação (até 2 min) e segue com a ação pendente; cancelável; código continua disponível.
- Docs: contrato (SEC-16/E5b), operação, manual.

Fora: WebAuthn dentro do popup; prova sem o portal; mudar a janela de prova (continua a do tenant).

## Critérios de aceitação

- [x] Sem aprovação no portal, o resgate não dá prova; pedido vencido ou de outra chave/usuário é recusado.
- [x] Aprovação exige sessão do cofre confirmada há menos de 60 s do mesmo usuário; auditada.
- [x] O resgate grava a prova uma única vez; a entrega segue as regras da E2 (permissão, política, item, cotas).
- [x] Popup fechado ou trocado: nada é aplicado automaticamente; sem laço de pedidos.
- [x] Teste de fumaça da extensão no Chromium cobre o fluxo com a página do portal; simulação e testes unitários.

## Estratégia técnica

Pedido em `vault_records` (tipo `extproof`, chave = pedido opaco, valor = chave do dispositivo, validade, aprovação). Aprovação pelo caminho `confirmed()` do portal; resgate pelo caminho DPoP da extensão (`inAccess`), que reescreve a autorização com `proofAt`. Reaproveita a confirmação de identidade e o Windows Hello do portal (NA-0198).

## Mudanças de escopo e decisões

- 2026-11-24 (Chrome): abrir a aba do portal fecha o popup; o popup guarda só o id do pedido e, ao reabrir, restaura a prova sem executar a ação (SEC-16); com o popup aberto, segue sozinho.
- 2026-11-24 (revisão independente, PASS_WITH_WARNINGS): texto de sucesso do portal orienta a selecionar Revelar/Copiar; só o 409 descarta o pedido guardado (limite/recusa/indisponibilidade mantêm e explicam); teste de outro usuário/tenant; comentário do `unlock` no lugar. Aceito: a identificação do dispositivo (16 caracteres, igual ao rodapé) é a conferência visual; uma confirmação fresca pode aprovar mais de um pedido pendente do mesmo usuário (a página bloqueia o cofre após aprovar).

## Riscos e mitigações

- Aprovar pedido de outro dispositivo: a página mostra a identificação do dispositivo do pedido (mesma do rodapé da extensão); o pedido só existe para o mesmo usuário e só a mesma chave resgata.
- Pedido vazado (URL): sem token; aprovação exige a conta do usuário com confirmação fresca; resgate exige a chave do dispositivo (DPoP).
- Laço de pedidos: um pedido por vez no popup; limite no servidor.

## Matriz de testes e evidências

vitest (serviço: pedido, aprovação, resgate, recusas; rotas; cliente da extensão; popup; página do portal), MySQL real (registro), `test:extension:web` (popup → aba do portal → aprovação → revelar), `tsc`, `vue-tsc`, `typecheck:extension`, `lint:changed`, `security:scan`, `manual:check-reviewed`; revisão independente.

## Baseline

2026-11-24 sobre `930004d4d`: vitest vault-security + extensão + componentes do cofre + views 617 PASS, 50 skipped.

## Rollback ou recuperação

Revert da PR; sem migração. O código do autenticador no popup continua funcionando.

## Aprovação

Decisão: `GO` — responsável em 2026-11-24 ("Pode seguir fim a fim na E5b").
