# NA-0196 — Registro da implementação

Base: `012ea6b69` (master com NA-0194 e NA-0197; antes `07c004f10`) (master após o merge da NA-0194; rebase sem conflito de código, hash do manual recalculado). Branch: feature/NA-0196-20261123-vault-delivery-settings.

## Pedido e objetivo

Na homologação de 2026-11-23 o responsável tinha a permissão Revelar, mas o portal respondia "sem permissão": a política do tenant estava desligada e o item não estava liberado, e as duas coisas só existiam na API. Pedido: tornar isso administrável e claro pela tela, validando os lugares e o fluxo por simulação. Durante a frente, pediu também mover "dispositivos conectados" para um botão com janela.

## Implementação

- Backend: `POST /vault-security/availability` (orientação ao usuário sem desbloqueio, mesma regra de permissão e escopo da entrega); visão geral com política (revelar/copiar/cota), itens liberados e nome do item nas propostas; pendências e aprovação incluem política e item; propostas de item para Secret revogado/removido escondidas.
- Portal: bloco **Entrega de senhas no tenant**; lista **Itens liberados** com **Retirar liberação**; **Ações → Entrega do item…** abre a administração restrita ao item (sessão compartilhada com a seção); coluna **Valores protegidos** com motivo e aviso geral por papel; **Aguardando aprovação** no lugar de proposta duplicada; **Dispositivos conectados** como botão + janela.
- Simulação (`test:vault-administration:web`): 5 cenários novos (usuário sem política → gestor liga → aprova; permissões; liberação pela linha; usuário revela; celular), revisão de layout/ruído/acessibilidade e capturas por tela.
- Docs: manual (`hosts`), `OPERATIONS-vault-security.md`, contrato NA-0177.

## Validação

- Ran: vitest vault-security + portal + shared (1516+ PASS); `test:vault:real` (MySQL real, availability com escopo e itens liberados); `test:vault-administration:web` 12 cenários PASS, 18 capturas, auditoria 8 propostas/8 aplicações; `test:vault:frontend` PASS; `tsc`, `vue-tsc`, `lint:changed`, `security:scan` (hashes revisados das traduções atualizados), `manual:check-reviewed` PASS.
- Ran: revisão independente (subagente): PASS_WITH_WARNINGS; achados LOW/MEDIUM corrigidos (ver plano).
- Skipped: `validate:sonar` local (tokens do responsável); capturas do manual não refeitas (procedimento descrito no texto).

## Recuperação

Revert da PR; sem migração (a API de proposta/aprovação de política e item já existia).

## Pendências

- Homologação: ligar a política, conceder Revelar/Copiar, liberar `secret-ssh-teste2` e revelar.
- Planilha de metas 2027: pendente de atualização (registrar NA-0194/0195/0196).

## Diário de interações

### 2026-11-23T23:20:00-03:00 — Implementação, simulação e revisão

Implementação, simulação no navegador (com ajustes de UX vindos das capturas) e revisão independente acima.

### 2026-11-24T00:40:00-03:00 — Encerramento da NA-0197 e rebase

NA-0197 (triagem do OpenSSL 3.5.9-r1 no Redis) mesclada em `012ea6b69`; NA-0196 atualizada sobre o master.
