---
change_id: NA-0076
title: Movimento nativo de páginas no acesso ao trial
type: feature
status: ready-for-tests
created_at: 2026-10-26T09:34:17-03:00
base_branch: master
base_sha: 215ac13738b4d0a24d53de41d991a692459434be
branch: feature/NA-0076-20261026-trial-page-motion
owner: root
planner: root
risk: low
issue: null
---

## Contexto e situação anterior
NA0075 adicionou um cartão de carregamento. Usuário prefere a transição nativa de telas, descrita como pousar em main.css.

## Problema e objetivo
Reproduzir fade/translateY da navegação do NodeAccess no percurso site → cadastro.

## Escopo
Remover overlay visual, aplicar saída do site90ms ease-in/-4px e chegada do trial-shell170ms ease-out/+6px. Apenas JS/CSS do CTA e CSS scoped TrialView.vue. Publicar assets e frontend; backend e dados preservados.

## Critérios de aceitação
- [x] Mesmos tempos/easing/deslocamentos do padrão page do aplicativo, sem cartão visual.
- [x] Reduced-motion sem animação nem espera90ms; Enter/modificadores/nova aba/download e href semJS preservados.
- [x] Voltar limpa saída; navegação única; fallback evita clique perdido.
- [x] Entrada apenas na montagem da tela, sem repetir a cada etapa/validação.
- [ ] Deploy sófrontend eassets com backup, imagens/configpinned e serviços restantes preservados.

## Estratégia técnica
Reutilizar valores do padrão existente, sem alterar estilos globais/terminal. Origens distintas exigem animações na origem e no destino. Status somente acessível; foco mantido. Frontend compilado e publicado por imagem identificada, registrando override de frontend na implantação existente.

## Riscos e mitigações
Evitar afetar áreas do terminal e permissões. Conferir sessões antes de recriar somentefrontend; não reiniciar backend/gateway/stateful. Registrar origem/digest do frontend sem atribuir uma nova release integral ao backend antigo.

## Matriz de testes e evidências
Browser saída/entrada desktop/mobile/reducedmotion/back/modificadores/fallback; build/tipos/lint do frontend; revisão independente; smoke públicoGET sem cadastro e preservação de serviços.

## Baseline
Master215ac137 limpa. NA0075 browserpúblico passou; padrão page confirmado: leave90ms ease-in(-4px), enter170ms ease-out(+6px).

## Rollback ou recuperação
Backup dos2assets e imagem/configuração do frontend atual. Reverter sófrontend/assets; nunca restaurar banco ou reiniciar serviços não afetados.

## Mudanças de escopo e decisões
Usuário explicitamente substituiu efeito anterior pelo padrão do aplicativo. Ajuste de chegada no frontend é necessário por ser outra origem; não adicionar dependências.

## Aprovação
Pedido explícito do usuário. Decisão: GO após revisão independente do plano; gates de produto e operação separados antes da publicação.
