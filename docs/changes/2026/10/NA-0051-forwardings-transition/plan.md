---
change_id: NA-0051
title: Corrigir raiz da página de encaminhamentos para a transição Vue
type: fix
status: ready-for-review
created_at: 2026-10-09T13:51:33.550925-03:00
base_branch: fix/NA-0050-20261009-wsl-dev-stack
base_sha: 79d0d10f66bb09dd50caa2fc24e716f73fd7755e
branch: fix/NA-0051-20261009-forwardings-transition
owner: jeferson
planner: Codex
risk: low
issue: null
---

# NA-0051 — Raiz animável de ForwardingsView

## Contexto e situação anterior

Usuário relata avisos Vue ao abrir /forwardings. ForwardingsView renderiza NModal
e div como irmãos na raiz; AppLayout aplica Transition à página. Um fragmento
não pode receber a animação. Base local conhecida e limpa; publicação NA-0050
continua pendente de autenticação GitHub, sem alegação de master atualizada.

## Problema e objetivo

Eliminar aviso de raiz não animável preservando navegação, aparência e modais.

## Escopo

Mover o modal para dentro do div raiz existente e verificar navegação no browser.
Acrescentar captura desse aviso ao harness existente de encaminhamentos.
Fora: AppLayout, KeepAlive, terminal, transporte, autenticação, backend e containers.

## Critérios de aceitação

- [x] Aviso reproduzido antes e ausente depois em Chromium real.
- [x] Tela e modal funcionais, incluindo publicação, erro, retry e fechamento.
- [x] Remontagem ao mudar e retornar a query da rota funciona sem aviso de raiz.
- [x] Typecheck e harness de encaminhamentos passam.
- [x] Nenhuma mudança em estilos, área útil ou ciclo de vida do terminal.

## Estratégia técnica

Reutilizar o wrapper existente; modal Naive UI continua teletransportado.
Validar com APIs fictícias e navegador isolado, sem dados/sessões reais.
Checar raízes dos templates apenas para identificar a extensão do sintoma.

## Riscos e mitigações

Risco baixo de contexto de renderização do modal; testar abertura, Escape,
validação, erro/retry e navegação. Não envolver o RouterView em novo wrapper.

## Matriz de testes e evidências

| Critério | Teste | Evidência |
|---|---|---|
| Aviso e navegação | forwardings-resilience-playwright | reports/NA-0051 |
| Modal/ações e erros | harness existente com API mock | reports/NA-0051 |
| Tipagem | npm run typecheck -w apps/frontend | reports/NA-0051 |

## Baseline

SHA 79d0d10f66bb09dd50caa2fc24e716f73fd7755e, árvore limpa. Duas raízes identificadas no template
(NModal + div), log do usuário confirma aviso em Transition/ForwardingsView.

## Rollback ou recuperação

Reverter apenas o diff desta branch. Sem banco, configuração local ou deploy.

## Mudanças de escopo e decisões

IN_PLAN: correção mínima do bug relatado e regressão no harness existente.
ForwardingsView não consta nos sourceFiles do manual; nenhum procedimento muda.

## Aprovação

- Decisão: GO
- Aprovado por: usuário ao relatar o erro e solicitar continuidade da correção local.
- Aprovado em: 2026-10-09 (conversa).

## Evidências locais

- Ran: Chromium em frontend isolado 5191 com APIs simuladas: falha esperada antes
  na asserção de raiz animável; depois, 18 cenários aprovados, sem warning.
- Ran: frontend typecheck aprovado. Harness aguarda URL e fim da animação antes
  de considerar remount concluído, conforme revisão independente.
- Ran: análise somente leitura dos 70 templates de views encontrou duas raízes
  somente em ForwardingsView. Sem alteração de CSS ou marcação da área útil.
- Skipped: test:terminal-experience:web e test:terminal-pty:real, pois nenhuma
  área útil, resize, WebSocket, transporte ou fluxo de terminal foi alterado.
- Manual: conferir /forwardings no navegador habitual após atualizar a página.
- Nenhum arquivo mapeado no manual sofreu alteração.
- Relatórios antes/depois e typecheck em
  /home/jeferson/nodeaccess-workspace/reports/NA-0051/; os checks no SHA final
  e a revisão independente são registrados externamente, sem novo commit de log.
- Referência técnica: https://vuejs.org/guide/built-ins/transition.html
