---
change_id: NA-0077
title: Aviso claro nas preferências opcionais do cadastro
type: feature
status: ready-for-tests
created_at: 2026-10-26T10:24:22-03:00
base_branch: master
base_sha: 201afd9ae524fc0e7a4d86e222d5fca60266dbac
branch: feature/NA-0077-20261026-trial-preferences-notice
owner: root
planner: root
risk: low
issue: null
---

## Contexto e situação anterior
O cadastro já mantém as autorizações de marketing e pesquisas desmarcadas. O usuário aceitou manter essa escolha ativa e pediu um aviso amigável e visível.

## Problema e objetivo
Explicar as preferências junto aos controles sem depender de tooltip ou sugerir consentimento automático.

## Escopo
Somente fieldset das preferências no cadastro TrialView.vue: aviso permanente com título e texto aprovados, estilo scoped nas cores existentes e associação acessível. Sem mudar modelos, defaults, APIs, termos ou fluxos de gerenciamento.

## Critérios de aceitação
- [x] Aviso visível: Você escolhe o que receber; assuntos do interesse; opções não interferem no teste.
- [x] Dois consentimentos inicialmente desmarcados, alternáveis por teclado e mouse; termos independentes.
- [x] Sem overflow em celular/desktop e legível nos temas claro/escuro.
- [ ] Frontend publicado com backup, sem mudanças de backend, dados ou outros serviços.

## Estratégia técnica
Usar bloco estático dentro do fieldset, borda de destaque e ícone decorativo, sem novo componente/dependência ou estado. aria-describedby no fieldset relaciona a explicação ao grupo.

## Matriz de testes e evidências
Build/vue-tsc, lint incremental, navegador 390/1440 em claro/escuro, marcação/desmarcação e ausência de submissão. Revisão independente, CI no SHA exato, smoke público. Terminal/PTY não aplicáveis: área útil e estilos globais não mudam.

## Baseline
Master 201afd9 sincronizada; cadastro e transição publicados pela NA0076. Texto anterior curto e dois campos desmarcados.

## Riscos e mitigações
Mudança visual localizada; reutilizar tokens de cores e ajustar quebra de texto.

## Rollback ou recuperação
Implantação somente frontend, com backup de imagem/configuração, zero sessões e guard temporário de novos WS. Reverter imagem anterior; sem restaurar dados.

## Aprovação
Usuário aprovou explicitamente aviso e manutenção dos campos desmarcados. Decisão: GO após revisão independente: manter defaults e regras intactos, verificar acessibilidade/temas/teclado e backup próprio antes da publicação.
