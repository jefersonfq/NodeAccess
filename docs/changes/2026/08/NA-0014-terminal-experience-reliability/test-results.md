---
change_id: NA-0014
tested_sha: LOCAL_WIP
tested_at: 2026-08-10T10:16:00-03:00
status: passed
---

# Resultado dos testes — NA-0014

## Resultado

PASS para o fluxo simulado de terminal crítico, concorrência de túneis e presença em `/hosts`.

## Causas confirmadas

- Saída SSH atualizava estado reativo a cada fragmento, elevando trabalho da UI em programas de redesenho contínuo.
- Mudança de fonte executava fit antes da estabilização do layout.
- A política de comandos consultava regras e ação padrão no banco para cada tecla, introduzindo latência e permitindo competição assíncrona entre caracteres.
- Sessões paralelas abriam túneis próprios; agora reutilizam por tenant, usuário, host e forwarding, sem compartilhamento entre usuários.
- A presença encerrada aguardava resposta/cache antes de desaparecer visualmente.

## Evidências

| Validação | Resultado |
|---|---|
| Playwright Ctrl+scroll | 14 px → 15 px e resize enviado |
| Playwright ANSI/HTOP | primeiro frame fragmentado em 19 ms na regressão final |
| Chromium/CDP + SSH real (`top`) | primeiro retorno em 53 ms; 7.126 bytes em 6 eventos; tela cheia renderizada |
| Chromium/CDP + SSH real (`htop`) | inconclusivo no host 236: comando retornou só 79 bytes e não abriu a interface |
| Playwright edição do host | nome sem reconexão; porta com reconexão; modal móvel dentro de 390 px |
| Playwright passphrase PEM | detecta criptografia, bloqueia senha ausente, envia senha e funciona por teclado/mobile |
| Chromium/CDP runtime | zero exceções, logs de erro ou falhas de rede não canceladas no fluxo final |
| Limites do zoom | 10–24 px; scroll sem Ctrl preservado |
| Ocupação do terminal | gap inferior 8 px; sem corte relevante |
| Sincronia PTY/xterm | 126×35 em ambos após zoom |
| Túneis em outras abas | um único túnel reutilizado em duas sessões; fechamento por último proprietário |
| Presença encerrada `/hosts` | removida imediatamente e API reconciliada |
| Testes unitários NA-0014 | 16/16 passaram |
| Layout harness existente | passou sem findings |
| Typecheck frontend/backend | passou |
| `git diff --check` | passou |

## Comandos

```bash
npm run test:terminal-experience:web
npm run test:pem-key-passphrase:web
npx vitest run apps/backend/src/modules/tunnels/tunnel-concurrency.test.ts apps/frontend/src/services/session-presence-projection.test.ts
npx vitest run apps/backend/src/modules/session-command-policy/session-command-ssh-input-policy.test.ts
node tools/frontend/terminal-ui-layout-harness.cjs
FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9360 HOST_ID=236 RUN_HTOP=1 INTERACTIVE_COMMAND=top node tools/frontend/terminal-cdp-real-flow.cjs
npm run typecheck -w apps/frontend
npm run typecheck -w apps/backend
git diff --check
```

## Artefatos

- `/tmp/nodeaccess-terminal-htop.png`
- `/tmp/nodeaccess-terminal-experience.json`
- `/tmp/nodeaccess-terminal-top-retest.json`
- `/tmp/nodeaccess-terminal-htop-retest.png`

## Observações

- O Playwright usa WebSocket SSH simulado e fragmenta o frame ANSI em várias mensagens para reproduzir carga interativa sem depender de um host externo.
- O frontend final foi validado em `http://127.0.0.1:5178` para evitar bundle antigo na porta 5173.
- Túneis automáticos são compartilhados somente entre sessões do mesmo tenant, usuário, host e forwarding. Cada aba vira proprietária; fechar uma aba apenas libera sua referência e o túnel encerra quando a última sair.
- A decisão da política continua ocorrendo antes de enviar o Enter ao host. Teclas sem submissão não consultam o banco, e avaliações da mesma sessão são serializadas.
- O fluxo CDP real agora exige `terminal-ready` e `terminal-input-ready`; permanecer apenas em `Connecting` falha o teste em vez de gerar falso positivo.
- O teste de túnel precisa executar fora do sandbox porque abre um listener efêmero em `127.0.0.1`; dentro do sandbox o sistema retorna `EPERM`, sem relação com a lógica do produto.
- A governança de commits não foi executada nesta rodada porque a frente ainda está em `LOCAL_WIP`; ela exige `base/head` já commitados.
