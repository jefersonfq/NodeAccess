Tarefa: investigar e corrigir bug de backend no NodeAccess.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-lite.md` se a regra de produto importar
4. `ai/modules/auth.md` ou `ai/modules/ssh.md` se o bug tocar esses dominios
5. arquivos diretamente afetados em `apps/backend/src` e, se preciso, `packages/shared/src`

Fluxo:
- reproduza o menor caminho do bug
- identifique modulo, rota, schema e servico afetados
- confirme se o erro e de regra, validacao, transporte ou persistencia
- mude o minimo necessario
- rode validacao proporcional ao risco

Resposta esperada:
- causa raiz
- mudanca aplicada
- validacao feita ou faltante
