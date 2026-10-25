---
change_id: NA-0073
title: Validação orientada do cadastro de teste e diagnóstico de e-mail
type: fix
status: ready-for-publication
created_at: 2026-10-24T23:36:17-03:00
base_branch: master
base_sha: df3c8c0947f2389b5f734d508e250004d14763d2
branch: fix/NA-0073-20261024-trial-validation
owner: root
planner: root
risk: medium
issue: null
---

# NA-0073 — Validação orientada do cadastro de teste e diagnóstico de e-mail

## Contexto e situação anterior

Formulário aceita digitação inválida, exibe erros genéricos longe dos campos e permite acionar botão sem termos. Usuário relata não receber e-mail.

## Problema e objetivo

Orientar preenchimento antes do envio e diagnosticar o envio autorizado sem confundir aceite SMTP com entrega na caixa.

## Escopo

- Formulário público: máscara de telefone nacional (fixo/celular), preservando +DDI; nome completo com pelo menos duas palavras de três letras; validação de e-mail; erros inline, foco e correção reativa; botão bloqueado sem termos.
- Contratos de cadastro coerentes no backend, testes e texto público usando teste/demonstração, inclusive CTA do site, e-mails, menu e laboratório; alinhamento dos capítulos do manual que citam esses rótulos.
- Consentimentos opcionais desmarcados; investigação SMTP e envio controlado à caixa expressamente indicada pelo usuário.
- Excluídos: mudanças de autenticação, tenants normais, infraestrutura de laboratório, quotas ou marketing automático.

## Critérios de aceitação

- [x] Telefone opcional vazio passa; máscara progressiva nacional e validação rejeitam entradas inválidas; internacional explícito preservado.
- [x] Nome completo e e-mail recebem validação clara junto dos campos antes do envio; backend permanece autoritativo.
- [x] Termos pendentes desabilitam CTA; corrigir campo remove erro correspondente; falhas identificam campo e foco sem perda de dados.
- [x] Consentimentos opcionais continuam desmarcados e independentes; teste funciona sem opt-in.
- [x] Interface/site/e-mails usam teste ou demonstração; mobile, teclado e estados existentes preservados.
- [x] Diagnóstico de e-mail registra somente evidência sanitizada, distingue falha, aceite SMTP e entrega confirmada; envio de teste restrito à caixa autorizada.
- [ ] Revisão independente, testes relevantes e publicação com backup atual preservam acessos e dados existentes.

## Estratégia técnica

Mudanças pequenas no fluxo trials. Reutilizar validação e componentes existentes sem novas dependências. Erros por campo com aria-describedby e foco. Alterar apenas textos visíveis, mantendo identificadores, flags e URLs existentes. Diagnóstico remoto inicialmente somente leitura. Publicação por scripts oficiais com nova captura/backup do estado atual, sem reutilizar checkpoints anteriores.

## Riscos e mitigações

| Risk | Impact | Mitigation | Stop criterion |
|---|---|---|---|
| Validação excessiva | Bloquear nomes reais | Unicode, partículas e regra explicitamente solicitada | Divergência frontend/backend |
| Máscara | Alterar telefone | Preservar +DDI e testar colagem/edição | Normalização silenciosa incorreta |
| Envio SMTP | Duplicar mensagens | Teste único rastreável autorizado | Destinatário fora de escopo |
| Deploy | Interromper acessos | Backup atual e guardas de estado | Drift ou teste falha |

## Matriz de testes e evidências

| Criterion/risk | Test/harness | Environment | Evidence | Required |
|---|---|---|---|---|
| Contratos | Unitários e API | Local descartável | Logs privados | yes |
| UI | Unitários, browser mobile/desktop, teclado | Local | Relatório | yes |
| E-mail | Estado da fila e envio controlado | Remoto autorizado | Diagnóstico sanitizado | yes |
| Publicação | Build, CI, smoke público e preservação | Local/remoto | Evidência por SHA | yes |

## Baseline

Base df3c8c0947f2389b5f734d508e250004d14763d2, master limpo; capturas fornecidas revisadas. Baseline executado: 95 testes passaram em trial.service frontend, trial-contact backend e trial.service backend (Vitest 4.1.12).

## Rollback ou recuperação

Preservar pacote/imagens, configuração, sites e banco atuais antes de publicação. Não restaurar banco antigo após novas gravações. Sem migração prevista; reversão de código via PR ou pacote anterior validado.

## Mudanças de escopo e decisões

Pedido explícito autoriza correções, renomeação pública e envio de teste. Autorizações anteriores de commit, integração e publicação persistem nesta frente. Não pré-selecionar consentimentos. Entrega SMTP não será descrita como confirmação da caixa de entrada.

## Aprovação

- Decisão: GO
- Aprovado por: usuário (pedido explícito), root (escopo técnico).
- Aprovado em: 2026-10-24, America/Sao_Paulo.
