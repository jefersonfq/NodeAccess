# NA-0095 — Contratos do gateway SSH nativo

Executado no worktree `/tmp/nodeaccess-NA-0095`, Node24.21.0, base `4a77f7139600e70aa612e753418978d9b31b10ae`.

| Validação | Resultado |
|---|---|
| Vitest do módulo, incluindo parser/diagnóstico | 74 testes PASS em3 arquivos;65 contratos novos |
| Cobertura direcionada do serviço, sem alterar configuração versionada | 627/663 linhas (94,57%);86/95 funções (90,52%);333/397 branches (83,87%) |
| Gate70/70/60 nessa medição direcionada | PASS |
| ESLint do novo arquivo | PASS |
| Typecheck backend no checkout isolado | PASS após build de packages/shared e resolução local no worktree; falha inicial era artefato shared antigo |
| SSH/PTY real, VPS, screenshots | Não aplicável: apenas testes; nenhuma alteração na área útil, transporte ou interface |

Comando de cobertura: `node node_modules/vitest/vitest.mjs run apps/backend/src/modules/native-ssh-gateway --maxWorkers=1 --reporter=dot --coverage --coverage.include=apps/backend/src/modules/native-ssh-gateway/native-ssh-gateway.service.ts --coverage.reporter=json-summary --coverage.reportsDirectory=/tmp/NA0095-coverage`.

Esta medição focal não substitui o gate integrado de todos os serviços. Não foram reduzidos thresholds nem excluídas fontes do projeto. As primeiras51 adições produziram59,57% e falharam o gate focal; os contratos adicionais de eventos, MFA e seletor elevaram a cobertura com execução real das regras.

## Contratos observados

- Ciclo operacional: configuração salva/fallback, heartbeat com TTL, desabilitado/erro/stopped e tolerância a Redis indisponível.
- Autenticação: métodos recusados, usuário inexistente/inativo/bloqueado/sem senha, senha inválida, restrição de trial, limitação por IP/login e atraso.
- MFA: senha aceita continua pendente de MFA; código válido/inválido, três tentativas, falhas de email/Redis, timeout de prompt, entrada sem eco e cancelamento.
- OTP: escopo de tenant, cooldown, limite de envio, TTL, consumo único, contador de tentativas e entradas de tamanho diferente.
- Sessões: escopo de acesso reaplicado ao alvo, usuário SSH alternativo, encaminhamento de bytes/exec, mensagens públicas sem erro técnico, close auditado uma vez, retorno ao shell.
- Seletor: paginação e limite100, teclado, atualização, pesquisa concorrente, descarte de respostas antigas e de respostas após cancelamento.

IO externo foi simulado nas fronteiras. Bcrypt/trial são dependências simuladas; não se presume que estes testes comprovem a implementação criptográfica ou a política trial em si. O teste existente de diagnóstico usa somente listener loopback descartável, sem autenticação ou host de produção. A falha aberta do rate limit em indisponibilidade Redis é comportamento atual documentado no teste, não uma mudança de política.

## Limites

Revisão independente da coordenação: PASS_WITH_WARNINGS,74 testes reproduzidos no checkout de integração (/tmp/na0095-independent.log). Vários métodos privados são acessados via Reflect; bcrypt, TOTP, managed session e Redis são simulados. Não comprova wireSSH, criptografia ou contadores Redis concorrentes reais. A coleta integrada de cobertura permanece separada desta medição focal. Não houve publicação, merge, homologação humana nem acesso à VPS.
