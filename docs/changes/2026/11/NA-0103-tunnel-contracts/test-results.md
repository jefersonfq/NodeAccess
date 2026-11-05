# NA-0103 — Contratos de túneis

Worktree `/tmp/nodeaccess-NA-0103`, Node24.21.0, base `4a77f7139600e70aa612e753418978d9b31b10ae`.

| Validação | Resultado |
|---|---|
| Novos contratos |46 PASS |
| Módulo padrão |66 PASS,3 SKIP opt-in,5 arquivos |
| Cobertura focal normal |324/331linhas97,88%;51/60funções85%;256/295branches86,77% |
| Gate focal70/70/60 |PASS, thresholds preservados |
| SSH real loopback opt-in existente |2 PASS, direct+bastion,6,49s |
| ESLint do novo arquivo |PASS |
| Typecheck backend |PASS após buildshared isolado |
| UI/screenshots/PTY |Não aplicável; somente testes, sem alterar área útil ou runtime |

Comando focal: `node node_modules/vitest/vitest.mjs run apps/backend/src/modules/tunnels --maxWorkers=1 --reporter=dot --coverage --coverage.include=apps/backend/src/modules/tunnels/tunnel.service.ts --coverage.reporter=json-summary --coverage.reportsDirectory=/tmp/NA0103-coverage`.

Ensaio real: `RUN_TUNNEL_REAL=true node node_modules/vitest/vitest.mjs run apps/backend/src/modules/tunnels/tunnel-real.test.ts --maxWorkers=1 --reporter=dot`. Servidores SSH/TCP e chaves gerados localmente; rota direta e bastion, confiança de chave, bytes, fallback de porta, desconexão e fechamento verificados. Não houve conexão à VPS ou host externo. Os2 casos são opt-in na suíte padrão e foram executados separadamente; o caso Redis real restante não foi habilitado nesta frente.

## Contratos novos

- Teste de destino com confiança SSH, ACL, trial, timeout e falha de forwarding; fechamento de stream/SSH.
- Rotas USER_AGENT/TENANT_AGENT/PRIVATE_ACCESS_CONNECTOR e AUTO: contexto autorizado, ausência/falha de agente, fallback apenas permitido e recusa de acesso nunca contornada.
- Credenciais com criptografia real de fixture: senha/PEM/passphrase, bastion e 1Password simulado, erro público sanitizado.
- Publicação no agente pessoal: usuário/tenant/versão/porta, repetição, simultaneidade, agente desconectado, ACL revogada e túnel fechado durante abertura.
- Inicialização: bind inválido, restrição trial, limpeza em erro, porta ocupada/fallback, rollback quando presença entre runtimes falha.
- Operação: proteção de campos internos, delegação entre runtimes, fim do trial/transporte, listeners/sockets fechados e falhas de audit/analytics best-effort.

A primeira coleta focal após37 novos testes tinha68,33%funções e falhou o gate70. Acrescentados nove cenários funcionais de streams, expiração, falhas de armazenamento e revogação; a segunda coleta passou. Não alterados thresholds, configuração de cobertura ou produto.

## Limites

Novos testes executam TunnelService real, simulando listeners TCP, conexão SSH, registry, ACL/trial e armazenamento. Não comprovam protocolo de publicação do agente ou Redis/ACL concorrentes reais. O ensaio SSH separado cobre somente transporte loopback direct/bastion. Cobertura focal não substitui o gate legado integrado. Revisão independente e integração ficam com a coordenação; nenhuma publicação/homologação humana inferida.
