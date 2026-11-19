# NA-0182 — Registro da implementação

Base: d5b59bf6d67709e7942fe4a73f5ab09badf14f04. Branch: feature/NA-0182-20261119-vault-extension.

## Pedido e objetivo

Extensão de navegador VaultNAccess no nível de um gerenciador de senhas: acessar credenciais compartilhadas e pessoais, e salvar URLs, chaves e senhas como no portal, com mais esforço de segurança e uma arquitetura que facilite mudanças.

## Implementação

Somente planejamento: `plan.md` com arquitetura de portas e adaptadores, contratos compartilhados, capacidades negociadas, controles mínimos, fatias E1–E7 e testes EXT-01..14.

## Validação

Ran: leitura de NA-0175 (avaliação/adendo), NA-0177 (contrato), do modelo de concessões do cofre e do estado das NA-0176/0178/0179; `change-governance` local. Skipped: testes de aplicação e Sonar (frente só documental, sem código).

## Recuperação

Reverter o commit desta frente; a planilha tem o hash anterior (de8ffa76e8f1) registrado no diário.

## Pendências

Plano da E1 (frente própria) quando NA-0176/NA-0178 estiverem integradas.

## Diário de interações

### 2026-11-19T10:40:00-03:00 — Plano inicial

Pedido ampliado pelo responsável. Plano escrito com decisão `NO_GO` até a aprovação. Próximo: o responsável revisar o plano.

### 2026-11-19T11:05:00-03:00 — Plano aprovado

Responsável aprovou o plano, confirmou que as credenciais compartilhadas são as da organização permitidas pela ACL e exigiu que o login na extensão dependa de permissão por usuário. Incluída a permissão `extension` (negada por padrão, concedida pelo admin no fluxo de concessões do cofre, verificada pelo servidor) na E1, nos critérios e nos testes EXT-15/16. Próximo: commit após o merge da PR71; plano da E1 quando NA-0176/NA-0178 estiverem mergeadas.

### 2026-11-19T15:45:00-03:00 — Branch e roadmap

Responsável pediu o merge da NA-0181 e a preparação desta frente. Branch criada a partir do master d5b59bf6d (merge da PR71); status `planned`. Roadmap atualizado numa escrita (META-017 e META-050, revisão 36; hash 860933136265, anterior de8ffa76e8f1). Próximo: PR do plano; plano da E1 quando as dependências estiverem integradas.
