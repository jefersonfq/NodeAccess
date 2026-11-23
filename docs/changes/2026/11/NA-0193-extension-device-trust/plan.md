---
change_id: NA-0193
title: Extensão VaultNAccess — dispositivo confiável por 7 dias, reconexão automática e por código do autenticador
type: security
status: ready-for-review
created_at: 2026-11-23T14:30:00-03:00
base_branch: master
base_sha: b8d99fd8ed8404d183561a5605a62f9b3b3a0593
branch: security/NA-0193-20261123-extension-device-trust
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0193 — Dispositivo confiável: reconexão automática e por código do autenticador

## Contexto e situação anterior

A autorização da extensão (30 min) fica só em `storage.session`, que é apagado quando a extensão é recarregada (botão **Atualizar**, NA-0190) ou o navegador reinicia. O contrato da E1 não tem renovação: toda reconexão exige a página de consentimento do portal com senha e código. A chave do dispositivo (não exportável, IndexedDB) e o registro do dispositivo no servidor sobrevivem.

## Problema e objetivo

Decisão do responsável (2026-11-23): o consentimento completo vale no primeiro uso; depois, (1) reconexão automática enquanto o login do portal que autorizou continuar ativo; (2) quando esse login acabou, só o código do autenticador no popup; (3) confiança do dispositivo por 7 dias desde o último consentimento completo.

## Escopo

Backend (`vault-security`):
- Migração: tipo `trust` em `vault_extension_tokens` (linha por dispositivo, `token_hash` = hash de `trust:<jkt>`, `expires_at` = +7 dias). Payload: versão de sessão, extensão, origem central do consentimento, erros de código.
- Troca de código (`/extension/token`): grava/renova a confiança (7 dias).
- Nova rota pública `POST /extension/renew` (`Origin` da extensão, versão mínima, DPoP com a chave do dispositivo, corpo `{ extensionId, otp? }`):
  - confere confiança viva da mesma extensão, dispositivo `ACTIVE`, permissão **Usar extensão**, usuário/tenant ativos e versão de sessão do usuário igual (portanto "Desconectar todas" corta);
  - sem `otp`: só se o login central do consentimento ainda existir (`refresh:<jti>`); caso contrário `401 EXTENSION_REAUTH_REQUIRED`;
  - com `otp`: TOTP do NodeAccess; erro grava contador (fora da reversão), responde `403 VAULT_REAUTH_FAILED`; no 5º erro apaga a confiança (volta ao consentimento completo);
  - sucesso: nova autorização de 30 min (limitada à confiança e, no modo automático, à sessão central), versão atual da política, auditoria `EXTENSION_RENEWED` (`SESSION`/`OTP`); limites por usuário.
- Autorização emitida por código do autenticador não depende de sessão central; as demais conferências por requisição continuam (dispositivo, permissão, política, versão de sessão).
- Revogar o dispositivo apaga a confiança (já apaga todos os tokens da chave).
- `POST /extension/forget`: **Desconectar** na extensão encerra a confiança e a autorização do dispositivo (decisão do planejador: sem isso, a reconexão automática anularia o botão).
Extensão: `renew(otp?)` no cliente; ao abrir o popup sem autorização, tenta a reconexão automática; se o servidor pedir o código, mostra só o campo do código (com a opção de autorizar pelo portal); erros explicados.
Docs: contrato (exceção à "sem renovação"), `OPERATIONS-vault-extension.md`, manual, plano de evolução.

Fora: Windows Hello/passkey (E5), revelar/copiar na extensão (E2).

## Critérios de aceitação

- [x] Depois de autorizar pelo portal, recarregar a extensão ou reabrir o navegador reconecta sem pedir nada enquanto o login do portal estiver ativo.
- [x] Com o login do portal encerrado, o popup pede só o código; código certo reconecta; código errado explica; 5 erros exigem o consentimento completo.
- [x] Após 7 dias do último consentimento completo, revogação do dispositivo, retirada de **Usar extensão**, "Desconectar todas" ou outra extensão, a renovação é recusada e volta ao consentimento completo.
- [x] Prova DPoP com outra chave, `Origin` de outra extensão ou versão abaixo da mínima são recusadas antes de qualquer verificação de código.
- [x] Auditoria de renovações e de códigos errados; nada novo gravado no disco da extensão.

## Estratégia técnica

Reaproveita a tabela e o repositório de tokens (`put/get/take` com o tipo novo) e o `ExtensionLocator` (localiza o dono pela linha de confiança). O contador de erros é gravado numa transação que conclui antes de responder o erro. `ExtensionAccess.origin` passa a aceitar `null` (modo código), e o `admit` só confere a sessão central quando há origem.

## Riscos e mitigações

- Reconexão sem senha amplia a confiança no perfil do navegador: mitigado por chave não exportável + DPoP, código do autenticador quando o portal não está logado, 7 dias, 5 tentativas, revogação imediata e auditoria. Decisão explícita do responsável; exceção registrada no contrato.
- E2 (valores) continuará exigindo confirmação recente por operação.
- Força bruta do código: 5 erros por confiança, limite por minuto por usuário, DPoP com nonce e anti-replay.

## Matriz de testes e evidências

vitest `vault-security` (serviço, rotas, repositório) e `apps/extension`; MySQL real (`test:vault:real`); `test:extension:web` (renovação automática e por código no Chromium real com portal simulado); `tsc`, `typecheck:extension`, `lint:changed`, `security:scan`, `manual:check-reviewed`; revisão independente de segurança; `validate:sonar` depende dos tokens do responsável.

## Baseline

2026-11-23, `b8d99fd8e`: vitest `vault-security` + `apps/extension` 322 PASS (44 opt-in skipped).

## Rollback ou recuperação

Revert da PR. Migração aditiva: o código anterior ignora linhas `trust`; para remover, apagar as linhas `kind='trust'` e voltar a restrição de tipo para `('code','access')`.

## Mudanças de escopo e decisões

- 2026-11-23 (planejador): **Desconectar** encerra a confiança; o idioma guardado sobrevive à limpeza da autorização.
- 2026-11-23 (revisão independente, PASS_WITH_WARNINGS): corrigidos — `/forget` autenticado pela chave do dispositivo (funciona com autorização vencida) e **Desconectar** também na tela do código; uma confiança por chave (novo consentimento de outro usuário no mesmo navegador a substitui, em vez de falhar); modo por código continua sujeito à política de métodos do tenant e à chave de métodos externos (na renovação e a cada requisição); limite de emissão antes da verificação do código. Aceito: renovação atravessa mudança de política (contrato atualizado); TOTP sem anti-replay, como no step-up do cofre.

## Aprovação

Decisão: `GO_WITH_RISKS` — responsável aprovou em 2026-11-23 (confiança de 7 dias; reconexão automática enquanto o login do portal estiver ativo; código do autenticador quando não estiver). Risco: muda a regra "sem renovação" do contrato da extensão.
