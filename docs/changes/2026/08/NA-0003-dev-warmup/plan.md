---
change_id: NA-0003
title: Warm-up observável do ambiente local de desenvolvimento
type: performance
status: ready-for-review
created_at: 2026-08-03T18:56:34-03:00
base_branch: performance/NA-0002-20260803-hosts-loading
base_sha: bae900e133b732b371780c7821ba507fd1bb148a
branch: performance/NA-0003-20260803-dev-warmup
owner: codex
planner: codex
risk: low
---

# NA-0003 — Warm-up do ambiente de desenvolvimento

## Contexto e situação anterior

Após reiniciar `npm run dev`, a primeira abertura de Hosts sofre compilação fria do Vite e caches vazios do frontend/backend; depois fica instantânea. Medições anteriores mostraram API de hosts normalmente abaixo de 100 ms, enquanto uma instância Vite fria chegou a aproximadamente 20 s.

## Problema e objetivo

Tornar o cold start explícito, observável e menos perceptível, aquecendo somente recursos seguros do fluxo de Hosts após frontend e API estarem disponíveis. O warm-up não deve mascarar falha de serviço, vazar token nem se tornar requisito para produção.

## Escopo

- Criar script local de warm-up sem dependências novas.
- Aguardar frontend/API e pré-carregar a view de Hosts e endpoints críticos autenticados.
- Integrar o warm-up ao `npm run dev:raw` como processo finito e não bloqueante para os servidores.
- Registrar duração/status por recurso sem imprimir credenciais ou payload sensível.
- Criar testes unitários para configuração, assinatura e classificação de resultados.
- Permitir execução manual e modo estrito para CI/diagnóstico.

### Fora do escopo

- Warm-up em produção, criação de dados, login real ou armazenamento de token.
- Alteração de MySQL, Redis, TTLs, ACL ou endpoints.
- Pré-carregar todas as telas ou recursos administrativos.

## Critérios de aceitação

- [x] `npm run dev:warmup` aquece recursos de Hosts quando frontend/API estão disponíveis.
- [x] O token existe apenas em memória e nunca aparece nos logs.
- [x] Falha de warm-up não encerra os servidores em modo dev; modo estrito retorna erro.
- [x] Saída diferencia recurso aprovado e falho com duração e número de tentativas.
- [x] Testes cobrem assinatura/configuração, sucesso, falha e proteção de segredo.
- [x] Execução repetida demonstra caminho aquecido ou documenta a limitação do Vite.

## Estratégia técnica

Implementar utilitário Node.js usando apenas módulos nativos. Ler configuração local existente, assinar JWT de desenvolvimento em memória, executar requests GET idempotentes e publicar resumo compacto. Manter funções puras em módulo testável e CLI separada.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Token em log | Alto | Não registrar headers/token; teste de não vazamento |
| Usuário ID local não existir | Baixo | Configurável e falha best-effort no dev |
| Warm-up atrasar servidores | Médio | Processo paralelo, finito e timeout por request |
| Carga desnecessária | Baixo | Somente GETs críticos e uma execução por start |

## Matriz de testes e evidências

| Validação | Evidência | Obrigatório |
|---|---|---|
| Funções puras | `node --test` | sim |
| Execução local cold/warm | resumo de duas execuções | sim |
| Token ausente da saída | assertion automatizada | sim |
| Typecheck/build existentes | comandos do projeto | sim |
| Governança no SHA final | summary JSON | sim |

## Baseline

- API de hosts observada em aproximadamente 40–100 ms quando serviços estão ativos.
- Vite frio isolado chegou a aproximadamente 20 s; instância aquecida ficou próxima de 2 s.
- Não há evidência de gargalo MySQL que justifique DDL nesta frente.
- Testes unitários: 7 cenários aprovados, incluindo segredo ausente da saída, origem externa rejeitada, retry e comportamento strict/best-effort.
- Execução local 1: view `89 ms`, hosts `73 ms`, sidebar `63 ms`, inventário `53 ms`, todos HTTP 200.
- Execução local 2: view `97 ms`, hosts `72 ms`, sidebar `40 ms`, inventário `55 ms`, todos HTTP 200.
- Limitação: os serviços já estavam ativos/aquecidos; o efeito completo sobre compilação fria será homologado após um restart controlado de `npm run dev`.
- Restart controlado: APIs aqueceram em `115–201 ms`, mas a transformação fria de `HostsView.vue` excedeu o timeout genérico de `5 s`; o processo saiu best-effort e os servidores permaneceram ativos. O timeout do Vite foi separado para `30 s` antes da revalidação.
- Revisão independente exigiu restringir frontend/API a loopback, explicitar GET, testar strict/best-effort e adicionar retry curto contra corrida de readiness; correções incorporadas antes do gate final.
- Segundo restart controlado: `npm run dev` iniciou API, gateway e Vite; warm-up concluiu `passed` na primeira tentativa. Transformação fria de Hosts: `11.348 ms`; hosts `138 ms`; sidebar `91 ms`; inventário `70 ms`. O processo finito saiu com código 0 e os três servidores permaneceram ativos.
- Revisão independente final: `PASS`; `test:dev-warmup`, checks de sintaxe e `git diff --check` aprovados.
- `typecheck` de backend e frontend aprovado. O build no diretório sincronizado transformou 3.259 módulos, mas encontrou `EPERM` do OneDrive ao copiar `favicon.svg` para `dist`; repetido com saída isolada em `/tmp`, concluiu os mesmos 3.259 módulos em `2m16s`, confirmando limitação ambiental e não erro de código.

## Rollback ou recuperação

Reverter os commits NA-0003 remove o processo de warm-up e restaura `dev:raw`; nenhuma informação persistida é alterada.

## Aprovação

- Decisão: `GO`
- Aprovado pelo usuário em 2026-08-03 ao autorizar seguir com o warm-up.
