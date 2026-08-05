---
change_id: NA-0007
title: Adiar commits até transição ou confirmação
type: process
status: tests-passed
created_at: 2026-08-05T18:45:00-03:00
branch: process/NA-0007-20260805-deferred-commits
risk: low
decision: GO
---

# NA-0007 — Política de commits por assunto

## Antes

O lifecycle orientava commits intermediários do plano e permitia interpretar cada etapa validada como momento de commit, gerando commits demais durante uma mesma conversa.

## Objetivo

Manter uma frente aberta durante implementação e testes e consolidar o commit apenas quando o usuário pedir, quando autorizar publicação/PR ou antes de iniciar um assunto distinto, com confirmação quando a autorização ainda não existir.

## Escopo

- Atualizar invariantes, início, implementação e gate de commit da skill.
- Diferenciar transição de estado de transição de assunto.
- Preservar validação, rastreabilidade e regra do SHA final.

## Critérios de aceitação

- [x] A skill proíbe commits automáticos por incremento ou gate interno.
- [x] Commit é permitido por pedido do usuário, publicação autorizada ou troca real de assunto.
- [x] Na troca de assunto sem autorização prévia, o agente deve resumir e perguntar antes do commit.
- [x] Mudanças incompletas não são apresentadas como prontas apenas para liberar outra frente.
- [x] A estrutura da skill passa no validador oficial.

## Resultado

- `quick_validate.py`: aprovado (`Skill is valid!`).
- Busca estática: nenhuma regra remanescente exige commit de plano ou incremento.
- Diff: somente skill, referência Git/PR e este plano.

## Fora do escopo

- Alterar proteções do GitHub ou convenções de mensagem.
- Fazer commit de assets locais não relacionados.

## Validação

- Validador estrutural do skill-creator.
- Busca estática por regras contraditórias.
- Revisão do diff.

## Rollback

Reverter este plano e as alterações textuais da skill.
