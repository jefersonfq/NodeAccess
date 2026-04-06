Use este prompt como base para tarefas no NodeAccess.

Contexto minimo:
1. Leia `ai/context.md`
2. Leia `ai/patterns.md`
3. Se a tarefa envolver regra de produto, leia `docs/PRD-lite.md`
4. Leia apenas o modulo relevante em `ai/modules/*`
5. Se a tarefa for de terminal, leia `ai/terminal/overview.md` e abra `ai/terminal/adapters.md` so se a integracao exigir
6. Abra `docs/PRD.txt` apenas se faltar regra detalhada

Instrucoes:
- mantenha contexto curto; nao resuma o produto inteiro na resposta
- leia so os arquivos do codigo diretamente afetados antes de editar
- preserve a arquitetura atual do monorepo
- prefira mudancas pequenas e verificaveis
- cite arquivos em vez de colar blocos longos
- para bugs, identifique primeiro se o problema esta no frontend, API, gateway ou shared

Entregavel esperado:
- mudar codigo ou docs com o menor contexto necessario
- explicar brevemente o que foi alterado
- informar se faltou validacao ou teste
