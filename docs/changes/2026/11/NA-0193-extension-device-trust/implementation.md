# NA-0193 — Registro da implementação

Base: `b8d99fd8e` (ver `plan.md`). Branch: security/NA-0193-20261123-extension-device-trust.

## Pedido e objetivo

Depois de atualizar a extensão (NA-0190), o responsável precisava autorizar de novo pelo portal. Decisão (2026-11-23): primeira vez pelo portal; depois reconexão automática enquanto o login do portal estiver ativo e só o código do autenticador quando não estiver; confiança do dispositivo por 7 dias.

## Implementação

- Migração aditiva `20261123170000_vault_extension_trust` (tipo `trust` em `vault_extension_tokens`); harness MySQL aplica a migração.
- Serviço: troca de código grava a confiança (7 dias, origem central, versão de sessão, extensão, erros); `renew` (automático com sessão central viva; código TOTP do NodeAccess quando não; contador de erros gravado antes do erro; 5º erro encerra a confiança; limites por usuário; auditoria `EXTENSION_RENEWED`/`EXTENSION_RENEW_DENIED`); `forget` (**Desconectar** encerra confiança e autorização, auditoria `EXTENSION_TRUST_ENDED`); autorização por código sem sessão central (`origin: null`) com as demais conferências por requisição.
- Rotas `POST /extension/renew` e `/extension/forget`; esquema compartilhado; container injeta a verificação TOTP.
- Extensão: `renew(otp?)` e `disconnect()` chamando `/forget`; popup tenta a reconexão automática ao abrir, mostra só o campo do código quando o servidor pede, explica código errado e confiança encerrada; idioma guardado sobrevive à limpeza da autorização.
- Docs: exceção no contrato NA-0177 §4, `OPERATIONS-vault-extension.md`, manual `hosts.md` (+ manifesto), `OPERATIONS-manual-pilot.md`, plano de evolução; hash revisado do `mysql-harness.py` em `security/gitleaks-fixtures.json` (justificativa: só a lista de migrações, depois da linha 87, mudou; a linha 82 sinalizada e o motivo do falso positivo continuam iguais).

## Validação

- Ran: vitest `vault-security`, `apps/extension`, `packages/shared`, componentes/serviços do portal 1218 PASS (48 opt-in skipped); `test:vault:real` (MySQL/Redis descartáveis com a migração nova) 45 PASS, incluindo os três testes da NA-0193; cobertura local das linhas alteradas 227/243 = 93,4%; `test:extension:web` 24 checks PASS (reconexão automática, por código, código errado, **Desconectar** encerra; capturas revisadas); `tsc`, `vue-tsc`, `typecheck:extension`, `lint:changed`, `manual:check-reviewed`, `security:scan` PASS.
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR; `DELETE FROM vault_extension_tokens WHERE kind='trust'` e restrição de tipo de volta a `('code','access')`.

## Pendências

- Homologação: autorizar pelo portal; **Atualizar** a extensão → reconecta sozinha; sair do portal → pede o código; código errado; **Desconectar** → volta ao portal.

## Diário de interações

### 2026-11-23T15:10:00-03:00 — Implementação

Implementação e validação acima. Decisão do planejador: **Desconectar** encerra a confiança (senão a reconexão automática anularia o botão); o idioma guardado deixa de ser apagado quando a autorização expira.

### 2026-11-23T15:50:00-03:00 — Revisão independente e ajustes

Revisão independente de segurança (subagente, somente leitura): PASS_WITH_WARNINGS — sem caminho de renovação sem a chave, sem cruzar usuário/tenant, contador de códigos sem burla por paralelismo (linha do usuário travada), revogações efetivas. Corrigidos: MEDIUM 1 (`/forget` pela chave do dispositivo; **Desconectar** também na tela do código), MEDIUM 2 (uma confiança por chave; teste MySQL com dois usuários), LOW 3 (política de métodos no modo por código), INFO (limite antes da verificação do código). Ran: vitest `vault-security` 292 PASS; `apps/extension` 44 PASS; `test:vault:real` 45 PASS; `test:extension:web` PASS.

### 2026-11-23T16:50:00-03:00 — CI da PR84

`sonar-real` reprovou por dois apontamentos S3403 no smoke da extensão (comparação com o vetor `renewed` de tipo inferido vazio; trocado por um campo de texto) e porque o harness `vault-extension` saiu com código 1 sem diagnóstico (o smoke não imprime pilha). Localmente o smoke passa em todas as execuções (3/3, ~23 s, também com o executável do Chromium indicado como na CI). Cobertura nova 93,3%. Reexecução para confirmar se é intermitente.

### 2026-11-23T17:55:00-03:00 — Merge e encerramento

PR84 mergeada em `master` (`fa757ac82`, 2026-11-23) com todos os checks remotos verdes (smoke da extensão falhou uma vez na CI sem diagnóstico e passou na reexecução). `master` local sincronizado. Status `closed`. Seguem: aplicar a migração no ambiente do responsável (`npm run db:deploy -w apps/backend`), homologação e `validate:sonar` local. Encerramento registrado na branch da NA-0194.
