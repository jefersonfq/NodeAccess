---
change_id: NA-0190
title: Extensão VaultNAccess — compilação local ao subir o ambiente, aviso de atualização e validação de comunicação
type: feature
status: ready-for-review
created_at: 2026-11-23T10:00:00-03:00
base_branch: master
base_sha: 740d58273bd7e01aa34a284a08842817d1fc7cc5
branch: feature/NA-0190-20261123-extension-local-update
owner: Jeferson Quintana
planner: Claude Code
risk: low
issue: null
---

# NA-0190 — Compilação local da extensão ao subir o ambiente e aviso de atualização

## Contexto e situação anterior

A extensão é carregada sem compactação para homologação. A cada mudança era preciso recompilar à mão com a origem e a chave do ID e recarregar em `chrome://extensions`. Extensões sem compactação nunca se atualizam sozinhas.

## Problema e objetivo

Pedido do responsável (2026-11-23): a cada mudança na extensão, atualizar o pacote ao subir o ambiente do NodeAccess e o navegador só pedir a atualização. Saída na pasta do projeto, de onde o responsável carrega a extensão.

## Escopo

- `tools/vault-extension/build-local.mjs` (+ testes): compila em `apps/extension/dist-local` com origem/chave/versão de variáveis ou de `apps/extension/local.json` (ignorado no Git), identificador derivado do conteúdo (sem mudança, sem recompilar), e publica `apps/frontend/public/vaultnaccess-build.json` para o portal de desenvolvimento. `npm run dev` chama em modo tolerante; `npm run build:extension:local` sob demanda.
- `vite.config.ts`/`manifest.ts`: `VAULTNACCESS_BUILD_ID` e `VAULTNACCESS_OUT_DIR` (só `dist` ou `dist-local`); `version_name` com o identificador.
- `src/core/update.ts`: o popup consulta o identificador anunciado (sem credenciais, sem cache, resposta limitada e validada) só em compilações locais; diferente do próprio → **Nova versão da extensão disponível** com **Atualizar** (`chrome.runtime.reload()`).
- Validação de comunicação (pedido do responsável na mesma data): antes de abrir a autorização, a extensão testa se o portal responde (qualquer resposta HTTP em até 5 s, sem credenciais); sem resposta, ou se a página de autorização não carregar, mostra **Não foi possível conectar ao NodeAccess. Verifique se o portal está no ar e tente novamente.** em vez de voltar em silêncio. O motivo da última falha fica 2 minutos em `storage.session` (só o código), lido uma vez pelo popup, para aparecer mesmo que o popup tenha fechado durante a tentativa.
- Teste de fumaça: mesmo identificador não pede; identificador novo mostra o aviso e **Atualizar** recarrega a extensão; capturas.
- Docs: `OPERATIONS-vault-extension.md`.

Fora: pacote assinado, `update_url` e instalação por política (E6); servidor/back-end inalterados; permissões do manifesto inalteradas.

## Critérios de aceitação

- [x] `npm run dev` compila a extensão local quando há origem configurada e não falha o ambiente quando não há ou quando a compilação falha.
- [x] Sem mudança no código, o identificador não muda e não há recompilação nem aviso.
- [x] Com outra compilação anunciada, o popup mostra o aviso e **Atualizar** recarrega a extensão.
- [x] Compilações de teste/produção não consultam o portal para isso.
- [x] Mesma chave → mesmo ID da extensão; permissões e CSP inalteradas.
- [x] Com o portal fora do ar, **Conectar** mostra que não foi possível conectar, sem abrir a janela de autorização.

## Estratégia técnica

Script Node no início do `npm run dev` (tolerante a falhas) chama o build Vite existente com variáveis novas validadas; o identificador vem do hash das fontes e da configuração; o portal de desenvolvimento serve o anúncio como arquivo estático; o popup compara e recarrega com `chrome.runtime.reload()`. A validação de comunicação fica no cliente (`connect`) e o motivo da falha passa do service worker ao popup por `storage.session`.

## Riscos e mitigações

Baixo. O anúncio só decide se um botão aparece; nada baixado é executado; a recarga lê a pasta local. Arquivos de configuração só com valores públicos e fora do Git.

## Matriz de testes e evidências

vitest `apps/extension`; `node --test tools/vault-extension/build-local.test.mjs`; `typecheck:extension`; lint; `test:extension:web`; compilação local real com o usuário do projeto.

## Baseline

`660b08096` + NA-0189 (PR80, mergeada depois em `740d58273`): vitest `apps/extension` 29 PASS; `test:extension:web` PASS.

## Rollback ou recuperação

Revert da PR; carregar `apps/extension/dist` como antes.

## Aprovação

Decisão: `GO` — responsável aprovou "fim a fim" em 2026-11-23, com a saída na pasta do projeto.
