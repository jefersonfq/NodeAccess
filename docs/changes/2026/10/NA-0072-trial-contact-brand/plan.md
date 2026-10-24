---
change_id: NA-0072
title: Contato opcional e identidade visual da degustação
type: feature
status: ready-for-publication
created_at: 2026-10-24T18:45:07-03:00
base_branch: master
base_sha: 5ab461f6eaaf3580e0e6d222f50248d16adc4fc5
branch: feature/NA-0072-20261024-trial-contact-brand
owner: root
planner: root
risk: medium
issue: null
---

# NA-0072 — Contato opcional e identidade visual da degustação

## Contexto e situação anterior

Degustação ativa na instalação 2.1.0; formulário sem telefone e com marca textual. Site já aponta ao trial.

## Problema e objetivo

Adicionar telefone opcional com finalidade clara, aplicar logos e cores existentes e apresentar CTA solicitado no site.

## Escopo

- Incluído: telefone opcional no cadastro, contrato/persistência/retenção/proteção correspondentes e consulta na listagem administrativa já protegida, identidade visual e estados responsivos da página; botão Faça uma degustação com tooltip acessível e link ao trial; atualização do aviso de privacidade.
- Excluído: contatos automáticos, marketing por telefone, alteração dos tenants normais, quotas, autenticação, provisionamento ou terminal.

## Critérios de aceitação

- [x] Cadastro sem telefone permanece válido; vazio é ausência; telefone inválido é recusado sem perder formulário.
- [x] Telefone tem finalidade explícita e não concede consentimento de marketing; não aparece em logs ou endpoints públicos; apenas administradores autorizados o consultam na listagem existente; retenção remove o dado.
- [x] Página usa marca existente, mantém todos os estados e funciona em mobile e teclado.
- [x] Site apresenta texto exato do CTA e tooltip acessível, incluindo etapa real de confirmação de e-mail.
- [x] Testes relevantes e revisão independente passam antes de integração/publicação.

## Estratégia técnica

Mudanças aditivas e restritas ao módulo trials. Reutilizar ativos de marca e padrões existentes. Migração nullable se necessária, sem atualizar registros anteriores. Site com backup/hash guardado. Publicação considera sessões existentes e novo backup, sem reutilizar checkpoints anteriores.

## Riscos e mitigações

| Risk | Impact | Mitigation | Stop criterion |
|---|---|---|---|
| Dado pessoal adicional | Uso incompatível | Finalidade clara, opcionalidade e retenção | Exposição em resposta pública |
| Regressão de cadastro | Falha de teste | Compatibilidade sem campo, testes de estados | Teste falha |
| Publicação concorrente | Interrupção | Backup atual e revisão operacional | Drift de runtime |

## Matriz de testes e evidências

| Criterion/risk | Test/harness | Environment | Evidence | Required |
|---|---|---|---|---|
| Telefone e retenção | Unitários/contrato e banco quando necessário | Local descartável | Logs privados | yes |
| UI | Typecheck/build, testes de fluxo, viewport/teclado | Local | Relatório/capturas | yes |
| Site | Link/tooltip/legais e hashes | Local/remoto | Relatório | yes |

## Baseline

- Base SHA: 5ab461f6eaaf3580e0e6d222f50248d16adc4fc5.
- Checkout limpo e master sincronizada antes da branch.
- Baseline backend60 e frontend19 passaram; dependências locais alinhadas ao lock antes das alterações de produto.

## Rollback ou recuperação

Preservar artefatos e configuração atuais. Campo novo opcional permite rollback de aplicação mantendo coluna. Nunca restaurar backup antigo sobre novas gravações. Site restaurável pelo hash da versão publicada.

## Mudanças de escopo e decisões

Pedido explícito do usuário autoriza telefone opcional, estilo e site. Autorizações anteriores de integração/publicação permanecem para esta evolução. Tooltip informa confirmação do e-mail; não promete provisionamento instantâneo. Base legal/finalidade devem ser claras; não há marketing telefônico neste escopo.

## Aprovação

- Decisão: GO
- Aprovado por: usuário (pedido explícito), root (escopo técnico mínimo).
- Aprovado em: 2026-10-24, America/Sao_Paulo.
