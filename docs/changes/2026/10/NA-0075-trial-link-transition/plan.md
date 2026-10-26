---
change_id: NA-0075
title: Transição ao abrir cadastro de teste pelo site
type: feature
status: ready-for-publication
created_at: 2026-10-26T08:58:03-03:00
base_branch: master
base_sha: 419056f42fb550ceca4401421dc4c2717adfc6d5
branch: feature/NA-0075-20261026-trial-link-transition
owner: root
planner: root
risk: low
issue: null
---

## Contexto e situação anterior
CTA do site navega diretamente ao trial, sem feedback de carregamento.

## Problema e objetivo
Comunicar a abertura do cadastro com uma transição discreta.

## Escopo
Somente CSS/JS do CTA e publicação desses assets. Sem mudanças no aplicativo, banco ou cadastro.

## Critérios de aceitação
- [ ] Clique e Enter apresentam feedback antes da navegação.
- [ ] Nova aba e teclas modificadoras mantêm comportamento normal.
- [ ] Movimento reduzido, voltar à página e ausência de JS preservam navegação.
- [ ] Publicação limitada aos assets, com backup e verificação.

## Estratégia técnica
Reutilizar o CTA existente e seu href; feedback não modal, navegação após pintura, reset em pageshow e fallback de tempo. CSS respeita prefers-reduced-motion.

## Riscos e mitigações
Não bloquear conteúdo ou interceptar cliques modificados; testar navegação real com destino local controlado, sem cadastrar contas.

## Matriz de testes e evidências
Browser local desktop/mobile/teclado/reduced-motion e verificação pública dos assets. Sem suites de backend por ausência de alteração de produto.

## Baseline
Workspace limpo, master419056f4. CTA atual é link nativo com tooltip; validação pública anterior passou.

## Rollback ou recuperação
Backup dos dois assets atuais e publicação atômica por arquivo com CAS. Restaurar apenas os assets se necessário.

## Mudanças de escopo e decisões
Pedido explícito do usuário para efeito no link de teste. Autorização de atualização do site permanece vigente.

## Aprovação
Escopo solicitado pelo usuário. Decisão: GO_WITH_RISKS sujeita à revisão independente do pequeno diff e navegador antes de publicar.
