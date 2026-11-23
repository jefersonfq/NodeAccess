# NA-0195 — Registro da implementação

Base: NA-0194 (ver `plan.md`). Branch: security/NA-0195-20261123-extension-reveal-copy.

## Pedido e objetivo

Fatia E2 do plano de evolução (revelar e copiar senha na extensão), aprovada de ponta a ponta com a E6 em 2026-11-23.

## Implementação

- Backend: `POST /extension/unlock` (TOTP do NodeAccess; prova `proofAt` na autorização; limite 5/5 min; erros contam no contador da confiança do dispositivo e o 5º encerra confiança e autorização); `POST /extension/deliver` (admissão com as cotas do portal; `tx.secret` com política, permissão da ação por dois gestores, item liberado e escopo; prova dentro da janela do tenant; JWE para a chave efêmera, validade = mínimo de 30 s, autorização e janela da prova; auditoria com dispositivo; item recusado = 403 sem derrubar a conexão); `capabilities` com `features.reveal/copy` e `proofUntil`. Autenticação DPoP verificada uma vez por requisição (`authenticate`/`inAccess`).
- Extensão: `core/envelope.ts` (chave RSA-OAEP efêmera não exportável; decifragem JWE com WebCrypto; contexto conferido: item, ação, chave, validade pelo relógio do servidor, origem); `unlock`/`deliver` no cliente; popup com **Revelar senha**/**Copiar senha**, código do autenticador quando não há prova, valor só em memória por 15 s (revelar e cópia pendente), **Confirmar cópia** como segundo gesto, respostas tardias descartadas, memória limpa em falha/desconexão.
- Docs: contrato NA-0177 (E2 e referência cruzada da regra de TOTP), `OPERATIONS-vault-extension.md`, manual, plano de evolução.

## Validação

- Ran: vitest `vault-security` + `apps/extension` 357 PASS (48 opt-in skipped); `test:vault:real` 46 PASS (valor real entregue cifrado, decifrado e ausente da auditoria); `test:extension:web` PASS (revelar com código e copiar para a área de transferência no Chromium real, JWE real); `tsc`, `typecheck:extension`, `lint:changed`, `security:scan`, `manual:check-reviewed` PASS.
- Ran: revisão independente de segurança (subagente): PASS_WITH_WARNINGS; MEDIUM (código sem encerramento) e LOW (validade pela janela da prova; validade/origem do contexto na extensão; cópia pendente expira; limpeza em falha e respostas tardias) corrigidos; INFO do contrato ajustado.
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR; sem migração. Desligar sem deploy: política do tenant ou retirar as permissões.

## Pendências

- Homologação: conceder **Revelar**/**Copiar** a um usuário (dois gestores), liberar o item, conectar a extensão e revelar/copiar com o código do autenticador.

## Diário de interações

### 2026-11-23T20:10:00-03:00 — Implementação e revisão

Implementação, revisão independente e ajustes acima.
