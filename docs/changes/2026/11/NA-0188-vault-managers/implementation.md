# NA-0188 — Registro da implementação

Base: `518e88aa5` (ver `plan.md`). Branch: security/NA-0188-20261123-vault-managers (checkout principal).

## Pedido e objetivo

Homologação da NA-0186 (2026-11-23): o responsável não conseguiu aprovar uma permissão para um gestor — com só dois gestores ninguém podia aprovar, a proposta venceu em 2 minutos sem aviso e o admin não gestor não via explicação. Pedido: gestor do cofre como permissão do usuário (opção A, dois gestores), validade das propostas por tenant de 2 min a 24 h, avisos de pendência, recusa de proposta impossível, explicação para não gestor e e2e Playwright do fluxo, UX e poluição visual.

## Implementação

- Backend (`vault-security`): mudanças `manager` e `proposalWindow`; `proposalSeconds` na política (120–86400 s, minutos inteiros); proposta vence na validade do tenant; recusa `VAULT_NO_APPROVER` (409) quando não há gestor ativo além do proponente e do afetado (rechecada na aprovação, com `FOR UPDATE` no conjunto de gestores para mudanças de gestor); ninguém propõe/aprova a própria gestão; `administration/status` devolve `{ manager, pending, managers }`; `overview` marca `users[].manager` e `policy.proposalSeconds`. A regra de aprovador distinto garante sempre ao menos dois gestores (sem regra de mínimo separada).
- Contrato `packages/shared`: esquemas das mudanças novas e do status/overview.
- Portal: `VaultAdministration.vue` (coluna **Gestor do cofre**, bloco **Validade das propostas**, botões desabilitados com motivo via `aria-describedby`, propostas de gestor/validade aprováveis, tempo restante em h/min, aviso de pendências antes de desbloquear, explicação para admin não gestor, modo `review` só com as propostas); `vault-http.ts` (código `VAULT_NO_APPROVER` → motivo `noApprover`); `vault-delivery.ts` (essa recusa mantém o cofre aberto); `vault-manager.ts` (`vaultAdministrationStatus`, `hasApprover`, `formatDuration`); `UsersView.vue` (etiqueta **Gestor do cofre**, faixa **N alterações do cofre aguardam sua aprovação** com **Revisar**, atualização a cada 60 s, ação desabilitada para não gestor; colunas recalculam quando online/gestores chegam depois da lista — corrige também a etiqueta **Online** da NA-0187); textos pt-BR/en.
- E2E novo `npm run test:vault-administration:web` (`tools/vault-security/administration-{fixture,flow,harness}`): Chromium HTTPS contra rotas reais do cofre, `VaultService`/`VaultAdministrationService`, bcrypt/TOTP/JWT reais; regras da administração em memória com o mesmo contrato do SQL; quatro pessoas sintéticas em contextos isolados; 7 cenários (não gestor, dois gestores bloqueados, promoção pela guia Usuários, permissão para gestor com terceiro gestor, validade 24 h, remoção de gestor, mobile) com checagens de rolagem horizontal, coluna espremida, avisos duplicados, nomes acessíveis, `aria-describedby`, rótulos, erros de página e respostas recusadas do cofre; capturas privadas em `.tmp/NA-0188`.
- Docs: manual `hosts.md` (+ manifesto revisado), `OPERATIONS-manual-pilot.md`, `OPERATIONS-vault-security.md`, contrato NA-0177 (exceção registrada); hashes revisados dos locales em `security/gitleaks-fixtures.json` (linha sinalizada inalterada).

## Validação

- Ran: vitest `vault-security`, `users`, `auth`, `packages/shared` 610 PASS (43 opt-in skipped); portal completo 1180 PASS; `tsc` e `vue-tsc` PASS; `lint:changed` (com worktree) 0 problemas.
- Ran: `test:vault:real` (MySQL/Redis descartáveis) 42 PASS, incluindo os testes novos da NA-0188 (fluxo de gestores/validade e duas remoções simultâneas).
- Ran: `test:vault-administration:web` 7/7 PASS (auditoria: 5 propostas, 4 aplicadas); `test:vault:frontend` PASS (regressões do cofre, catálogo e terminal).
- Ran: `manual:check-reviewed` PASS; `test:manual` PASS; `security:scan` PASS; `node --test tools/security-center/` 7 PASS.
- Ran: cobertura local das linhas alteradas (linhas + condições, arquivos de código): 340/363 = 93,7%.
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR. Sem migração: `proposalSeconds` em `config` é ignorado pelo código anterior (volta a 120 s); gestores incluídos pela tela continuam em `vault_managers`.

## Pendências

- Homologação pelo responsável (roteiro no PR).
- `npm run validate:sonar` local (tokens do responsável).
- Roadmap 2027 (planilha): sem ferramenta de edição nesta sessão.

## Diário de interações

### 2026-11-23T07:30:00-03:00 — Diagnóstico e decisão

Consulta somente leitura ao banco local: gestores eram só `admin` e `lucien`; as propostas tinham o próprio Lucien como beneficiário e venceram em 2 minutos. Opção C (admin promove sozinho) desaconselhada: admin cria contas e redefine senha/TOTP. Responsável escolheu a opção A e pediu a frente de ponta a ponta com e2e Playwright.

### 2026-11-23T08:10:00-03:00 — Implementação e validação local

Implementação conforme acima. O e2e encontrou e corrigiu: etiquetas da tabela de usuários que não apareciam quando o status chegava depois da lista; coluna de nomes espremida no celular (tabela com largura mínima e rolagem própria); janela **Revisar** poluída com a tabela e as configurações (agora só as propostas). Ran/Skipped conforme Validação.

### 2026-11-23T08:45:00-03:00 — Revisão independente e ajustes

Revisão independente (subagente, somente leitura): PASS_WITH_WARNINGS, nenhum caminho para uma pessoa sozinha obter poder no cofre. Corrigidos os dois MEDIUM (propostas que a aprovação recusaria saem da lista; retirar gestor apaga as propostas dele e reduzir a validade encurta as abertas) e os LOW 3, 5, 6 e 7 (`FOR UPDATE OF m`; status desconhecido sem ação/explicação e último estado mantido em falha; teste MySQL de corrida). LOW 4 documentado. Ressalva aceita: sem ação de retirar proposta. Ran: vitest `vault-security` 281 PASS; portal (cofre, serviços, views) 944 PASS; `test:vault:real` 42 PASS; `test:vault-administration:web` 7/7 PASS; `manual:check-reviewed` PASS.

### 2026-11-23T09:30:00-03:00 — CI da PR79

`change-governance` reprovou: critérios de aceitação do plano não estavam em checklist (convertidos). `sonar-real` reprovou com cobertura nova de 41,8%: os arquivos do e2e (`tools/vault-security/administration-*`) contam como código novo e não rodavam na CI. Novo `vault.administration.frontend.test.ts` executa o harness quando a CI coleta cobertura (mesmo padrão do `vault.frontend.test.ts`); o harness restaura ambiente e umask e usa diretório temporário curto para o Chromium. O harness de navegador `ha` (Alta disponibilidade, sem relação com esta frente) falhou uma vez; segue na reexecução. Ran: wrapper vitest com o harness 2 PASS; cobertura local das linhas alteradas incluindo o harness 786/881 = 89,2%.

### 2026-11-23T09:55:00-03:00 — Merge e encerramento

PR79 mergeada em `master` (`660b08096`, 2026-11-23) com todos os checks remotos verdes (após converter os critérios em checklist e pôr o harness e2e sob cobertura). `master` local sincronizado. Status `closed`. Seguem: homologação pelo responsável (roteiro no PR) e `validate:sonar` local (tokens do responsável). Encerramento registrado na branch da NA-0189.
