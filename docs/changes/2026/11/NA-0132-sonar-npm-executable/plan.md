---
change_id: NA-0132
title: Executável npm explícito no analisador Sonar
type: fix
status: ready-for-review
created_at: 2026-11-03T19:35:25.714918-03:00
base_branch: chore/NA-0093-20261103-sonar-integration
base_sha: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d
branch: fix/NA-0132-20261103-sonar-npm-executable
owner: Codex
planner: Codex
risk: low
issue: null
---

# Plano

Correção necessária autorizada para javascript:S4036 em analyze.mjs46. Remover busca PATH do npm; usar process.execPath e CLI absoluto validado vindo de npm_execpath ou layout padrão junto ao Node. Preservar versão5.0.2, args, token somenteenv e configuração revisada. Validar execução real com CLI sintético, PATH envenenado, caminhos inválidos, guards deargs e códigos de saída. Não rodar scanner nem alterar baseline aceita.

## Aprovação e recuperação

GO_WITH_RISKS dentro da autorização fim a fim e delegação explícita. Root fará integração; reversão do commit restaura runner anterior. Ambiente npm_execpath é configuração confiável do operador/CI, não entrada remota. Caminho customizado ausente falha orientando npm run.
