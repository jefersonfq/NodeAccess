# NA-0190 — Registro da implementação

Base: `740d58273` (merge da NA-0189). Branch: feature/NA-0190-20261123-extension-local-update.

## Pedido e objetivo

"A cada mexida na extensão, conseguimos já atualizar o pacote para no navegador só solicitar a atualização após subir o ambiente do NodeAccess?" — saída na pasta do projeto (o responsável carregava de `C:\Users\…\VaultNAccess-homologacao`).

## Implementação

Ver `plan.md` (escopo). `apps/extension/local.json` criado na máquina do responsável com a origem (`https://127.0.0.1:5173`) e a chave pública do manifesto que ele já usava, para manter o mesmo ID.

## Validação

- Ran: vitest `apps/extension` 36 PASS; `node --test tools/vault-extension/build-local.test.mjs` 3 PASS; `typecheck:extension` PASS; eslint `apps/extension/src` 0 problemas; `test:extension:web` 16 checks PASS (inclui portal fora do ar, sem aviso para a mesma compilação, aviso e recarga para outra; capturas revisadas); `npm run build:extension:local` com o usuário do projeto: compilou em `dist-local` com a mesma chave/ID e a segunda execução não recompilou.
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR; carregar `apps/extension/dist`.

## Pendências

- Responsável: carregar `apps/extension/dist-local` sem compactação uma vez (remover a cópia antiga para não duplicar o mesmo ID).
- Roadmap 2027: sem ferramenta de edição nesta sessão.

## Diário de interações

### 2026-11-23T10:15:00-03:00 — Implementação

Implementação e validação acima.

### 2026-11-23T10:40:00-03:00 — Validação de comunicação

Pedido do responsável: com o NodeAccess fora do ar, **Conectar** mostrava o código de relance e voltava sem explicação (a falha da janela de autorização virava "cancelada" e se perdia quando o popup fechava). Agora: teste de comunicação antes da autorização, motivo `offline` com mensagem própria, falha de carregamento da página de autorização tratada como `offline` e motivo guardado brevemente para o popup. Ran: vitest `apps/extension` 36 PASS; `typecheck:extension` PASS; eslint 0 problemas; `test:extension:web` 16 checks PASS (portal derrubado mostra a mensagem, sem abrir a autorização; captura revisada).

### 2026-11-23T11:50:00-03:00 — Publicação

Branch refeita sobre o merge da NA-0189 (`740d58273`), com o encerramento da NA-0189. Revalidado antes do push (ver abaixo no PR).
