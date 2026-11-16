---
change_id: NA-0177
title: Contrato de segurança do VaultNAccess para portal e extensão
type: docs
status: ready-for-review
created_at: 2026-11-15T21:52:17-03:00
base_branch: master
base_sha: ae188983d061a7bb5e6aaf855fd9d2f92416f3b8
branch: docs/NA-0177-20261115-vault-security-contract
owner: unassigned
planner: Codex
risk: medium
---

# NA-0177 — Contrato de segurança do VaultNAccess

## Contexto e situação anterior

NA-0175 entrega catálogo e editores; PR66 ainda aguarda fechamento. Adendos descrevem arquitetura híbrida, mas sessões, autorizações, revogação e auditoria precisam de contrato único verificável. A base foi atualizada por fetch; esta frente documental independente parte da master atual e será reconciliada após PR66.

## Problema e objetivo

Fechar o item 2 solicitado pelo usuário: contrato completo que oriente a implementação futura de desbloqueio, reveal/copy/fill e dispositivos, sem introduzir dependência operacional no NodeAccess existente.

## Escopo

Contrato normativo de domínio/API, estados, política inicial, matriz de permissões, modelo de ameaças, auditoria durável, revogação e aceites de integração. Registrar fechamento de NA-0175 somente após evidência real. Atualizar índice e roadmap em uma escrita agrupada.

Fora: implementar endpoints, banco, extensão, WebAuthn, HPKE, bridge, distribuição ou alterar autenticação/SSH/RDP/terminal/snippets. Definição documental não representa proteção já disponível em produção.

## Critérios de aceitação

- [x] Sessão central e sessão do cofre separadas, com tempos, lock e revogação definidos.
- [x] Matriz de ações nega revelação implícita por posse/admin/uso operacional.
- [x] Contratos de bootstrap, unlock, delivery e dispositivos cobrem replay, contexto, concorrência e erros.
- [x] Auditoria durável, limites, falhas, rollback e não regressão definidos.
- [x] Matriz de testes cobre cada decisão; revisão independente sem bloqueadores.
- [x] Documentos, índice, roadmap e evidência de validação consistentes; preparação de publicação conforme autorização (merge não presumido).

## Estratégia técnica

Inventário focal de auth/secrets/PEM e documentos prévios. Escolhas próprias do projeto explicitadas, fundamentadas em padrões oficiais. Ports de domínio e adaptadores separados; protocolo criptográfico e provas de compatibilidade são gates posteriores e não primitivas caseiras.

## Riscos e mitigações

| Risco | Mitigação | Critério de parada |
|---|---|---|
| Confundir contrato com runtime entregue | Estados e limites explícitos | Não ativar reveal antes dos gates de implementação |
| Alterar operações existentes | Sem edição de código; invariantes e testes futuros | Nova dependência de unlock no gateway |
| Garantia de revogação inexequível | Definir ponto de linearização e revisão das transações | Sem barreira autoritativa, delivery desabilitado |
| Homologação humana presumida | Pergunta específica e evidência separada | PR66 não mergeada sem confirmação |

## Matriz de testes e evidências

| Critério | Validação nesta frente | Limite |
|---|---|---|
| Contratos e ameaças | Revisão independente por cenário adversarial | Não é pentest/runtime |
| Documentação | Links locais, estrutura, referências, diff/check, lifecycle | Não demonstra compatibilidade de navegador |
| Roadmap | ZIP/XML, IDs e células preservadas | Sem Excel visual |
| PR66 | Gates do SHA 0c805d425 e homologação humana | Não herdar como teste de implementação futura |

## Baseline

Base ae188983d061a7bb5e6aaf855fd9d2f92416f3b8; inspeção read-only de AuthService, SecretService/rotas e PemKeyService. Rotas atuais não oferecem reveal. PR66 avaliada separadamente no SHA 0c805d42521b4540fd94a39858ffb2df1faccb8a.

## Rollback ou recuperação

Reverter somente documentos/índice e células desta revisão do roadmap, preservando edições posteriores do usuário. Sem migração, deploy ou mudança funcional. Branch da PR66 preservada.

## Mudanças de escopo e decisões

IN_PLAN: usuário autorizou fechar itens 1 e 2 fim a fim. Item 2 significa definir contrato de segurança conforme a lista apresentada; não inclui implementação dos itens 3/4/5. Autoridade para fechamento/publicação desta frente, sem presumir homologação humana de produto.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário, pedido de fechamento dos itens 1 e 2 fim a fim.
- Aprovado em: 2026-11-15T21:52:17-03:00
- Revisão independente: PASS_WITH_WARNINGS após correções; execução runtime e fechamento de PR66 permanecem fora dessa aprovação documental.
