Tarefa: investigar e corrigir bug com minimo contexto no NodeAccess.

Contexto minimo:
1. Leia `ai/context.md`
2. Leia `ai/patterns.md`
3. Leia `docs/PRD-lite.md` apenas se a regra de produto impactar a correcao
4. Leia `docs/PRD-map-lite.md` apenas para localizar PRD de dominio, se necessario
5. Leia somente o modulo `ai/modules/*` relacionado:
   - Modulo sugerido: `<preencher, ex: ai/modules/ssh.md>`
6. Leia apenas logs, arquivos e testes diretamente relacionados ao bug.

Bug observado:
```text
<colar erro, log ou comportamento observado>
```

Escopo:
- area suspeita: `<frontend | backend API | gateway SSH | shared | banco | desconhecido>`
- dominio: `<ex: bastions, terminal, snippets, forwarding>`

Regras:
- primeiro isolar causa raiz antes de editar
- nao mascarar erro com mensagem generica se puder melhorar diagnostico
- nao quebrar fluxo existente que ja funciona
- se houver mudanca de regra/decisao, registrar em PRD/worklog

Entrega esperada:
- causa raiz curta
- correcao aplicada
- validacao executada
- risco residual, se houver
