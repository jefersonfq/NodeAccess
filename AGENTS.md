# NodeAccess

Use contexto minimo.

Ordem de leitura:
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-lite.md` se a tarefa exigir regra de negocio do produto
4. Um modulo de `ai/modules/*` apenas se a tarefa tocar esse dominio
5. `ai/debug.md` apenas para investigacao
6. `docs/PRD.txt` apenas para regra de negocio especifica

Regras:
- nao carregar o PRD inteiro por padrao
- prefira `docs/PRD-lite.md` ao `docs/PRD.txt`
- nao repetir resumo do produto na resposta
- cite caminhos de arquivo em vez de colar trechos longos
- para mudancas pequenas, leia so os arquivos diretamente afetados
