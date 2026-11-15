# NA-0084 — Indicador de plantão no terminal: validação

Estado: LOCAL_WIP, sem publicação ou homologação humana. Base SHA: `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`.
Fingerprint SHA256 dos caminhos e conteúdos modificados/não rastreados de código (exclui docs/README): `b8cab6d8568ab5cb4df7a0763b78467519e7f18adbc3f1f2047a44417c2af1fc`.

| Verificação executada | Resultado |
|---|---|
| `npm run test:handover:core` | 148 testes, 11 arquivos: PASS |
| Laboratório API/JWT/Prisma/MySQL + terminal conectado à API real | 26 cenários: PASS_WITH_WARNINGS; SSH simulado |
| Revisão independente | 81 testes unitários + 25 cenários API; sem bloqueios |
| `npm run test:handover:terminal:web` | 9 grupos de verificações: PASS |
| `npm run test:terminal-experience:web` | baseline e regressão final: PASS |
| Builds shared/backend/frontend | PASS; avisos de chunks e anotação de dependência existentes |
| ESLint dos 48 arquivos alterados e lint das correções finais | PASS |
| `npm run manual:capture` / `npm run test:manual` | cinco capturas; 2 testes Node e 18 Vitest: PASS |
| `git diff --check` | PASS |

## Evidências

- [Interface simulada](terminal-indicator-ui.json): seleção/cópia, Tab/Escape, paginação, erro503/retry/vazio, ACL, troca de host com resposta atrasada, fullscreen, mobile, split, nota longa, barra à esquerda e ausência de polling fechado durante dois minutos simulados.
- [Laboratório real](terminal-indicator-real-api.json), [browser com API real](terminal-indicator-real-browser.json), [execução independente](terminal-indicator-independent.json).
- [Regressão terminal](terminal-indicator-regression.json): o campo changeId NA-0014 é o identificador legado do harness reutilizado.
- [Avaliação UX e 12 prints](terminal-indicator-ux.md).

## Correções encontradas durante os ensaios

Foco repetido da janela ignorava TTL; corrigido para reutilizar cache. Paginação removia o botão focado e perdia Escape; foco agora passa para o controle estável de fechar antes da troca. Cabeçalho fixo mantém fechamento acessível em notas longas. Overlay acompanha a lateral da barra. Hidratação de detalhes usa revisão autorizada para omitir conteúdo modificado concorrentemente após a seleção. As verificações foram mantidas e reexecutadas.

## Limites

HTTP/JWT/banco e migrações foram reais em laboratório descartável; SSH/WebSocket e shell externo foram simulados. Não houve acesso a VPS, comandos SSH em produção nem teste PTY real (transporte/resize não alterados). Geometria, linhas/colunas, mensagens de resize, entrada e conexões são comparadas antes/depois; não constituem benchmark de carga nem garantia universal. Consulta cobre até1000 metadados recentes por host, sem revelar existência/quantidade de notas privadas; notas autorizadas mais antigas podem ficar fora do recorte. Cache volátil de45s pode atrasar indicador; abrir/atualizar força consulta. Laboratório encerrou recursos próprios. Refinamentos finais de CSS foram validados na simulação de interface, depois do ensaio API real.

## Fechamento editorial

`npm run manual:check-reviewed`: PASS para todos os capítulos. Revisão visual independente: PASS_WITH_WARNINGS. Novos12prints sem bloqueios funcionais; pequena faixa de texto junto ao cabeçalho sticky é cosmética. Capturas gerais do manual têm ressalvas preexistentes de fixture: hosts mostra1no cabeçalho e237na paginação; sharing contém textos técnicos do harness. Capítulos terminal/handover revisados; gate editorial PASS não representa eliminação dessas ressalvas nem homologação humana.
