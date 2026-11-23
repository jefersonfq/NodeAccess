# NA-0189 — Registro da implementação

Base: `660b08096` (refeita sobre o merge da NA-0188) (ver `plan.md`). Branch: feature/NA-0189-20261123-extension-ui.

## Pedido e objetivo

"Consegui acessar a extensão. Pode dar uma estilizada nela e traçar o plano de evolução?" (2026-11-23).

## Implementação

- `apps/extension/src/popup/App.vue`: cabeçalho com marca e estado **Conectado**; boas-vindas com ícone e botão principal; código do dispositivo destacado; busca com ícone; filtro de tipo em botões (`aria-pressed`) no lugar do `select`; recentes em etiquetas; resultados com ícone por tipo, descrição e etiquetas; esqueleto de carregamento; vazio com ícone; rodapé com a garantia e **Desconectar**. Paleta do portal (tema Naive) com claro/escuro pelo sistema, foco visível e movimento reduzido. Lógica inalterada.
- `PopupIcon.vue`: ícones SVG locais (sem dependência nem recurso remoto).
- `messages.ts`: textos novos pt-BR/en.
- `tools/vault-extension/extension-smoke.mjs`: capturas claro/escuro dos estados e checagem de rolagem horizontal a 360 px.
- `evolution.md`: plano de evolução (E1.2, E6, E2, E5, E3, E4, E7).

## Validação

- Ran: vitest `apps/extension` 29 PASS (2 novos); cobertura local das linhas alteradas do popup 71/80 = 88,8%; `typecheck:extension` PASS; eslint `apps/extension/src` 0 problemas; `test:extension:web` PASS (Chromium real com a extensão desempacotada; capturas claro/escuro revisadas).
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR e recompilar a extensão.

## Pendências

- Homologação visual pelo responsável: recompilar com a origem do portal e recarregar a extensão.
- Roadmap 2027: sem ferramenta de edição nesta sessão.

## Diário de interações

### 2026-11-23T09:30:00-03:00 — Visual e plano

Implementação e validação acima. A NA-0188 segue na PR #79 (CI); esta frente parte do `master` porque não toca os mesmos arquivos.

### 2026-11-23T10:00:00-03:00 — Publicação

Responsável autorizou a frente fim a fim. Branch refeita sobre o merge da NA-0188 (`660b08096`), com o encerramento da NA-0188. Revalidado na nova base: vitest `apps/extension` 29 PASS, `typecheck:extension` PASS, `lint:changed` 0 problemas, `test:extension:web` PASS. Próximo: NA-0190 (atualização da extensão ao subir o ambiente), com a compilação na pasta do projeto.

### 2026-11-23T11:50:00-03:00 — Merge e encerramento

PR80 mergeada em `master` (`740d58273`, 2026-11-23) com todos os checks remotos verdes (após completar as seções do plano exigidas pela governança). `master` local sincronizado. Status `closed`. Seguem: homologação visual pelo responsável e `validate:sonar` local (tokens do responsável). Encerramento registrado na branch da NA-0190.
