# Fluxo de mudanças do NodeAccess

Cada frente nova possui exatamente um Change ID, um plano versionado e uma branch. Alterações já implementadas antes da adoção deste fluxo são preservadas; todo trabalho iniciado a partir de NA-0001 segue estes gates.

1. Criar `docs/changes/YYYY/MM/NA-XXXX-keywords/plan.md`.
2. Registrar situação anterior, objetivo, escopo, critérios, riscos, baseline, testes e rollback.
3. Criar `<tipo>/NA-XXXX-YYYYMMDD-keywords` a partir da base correta.
4. Implementar apenas o escopo aprovado e atualizar testes junto do código.
5. Executar validação proporcional e o harness no último SHA.
6. Usar commits convencionais com Change ID e trailers `Plan`, `Change-Date` e `Tests`/`Evidence`.
7. Abrir PR com antes, implementado, depois, riscos e evidências.
8. Mesclar somente após checks e homologação humana.

Branches paralelas são permitidas, mas não podem compartilhar Change ID, plano ou assunto. Prefira `git worktree` para isolamento. Push direto, force push e merge direto em `main` não fazem parte deste fluxo.

## Estado visível da entrega

Uma entrega deve informar estados separados; commit e push não significam merge:

| Estado | Significado |
|---|---|
| `LOCAL_WIP` | Existem alterações locais ainda sem commit |
| `COMMITTED` | A branch da frente possui commit próprio |
| `PUSHED` | O mesmo SHA foi enviado para a branch remota |
| `PR_OPEN` | O Pull Request foi confirmado no GitHub |
| `MERGED` | A alteração passou a integrar a branch remota padrão |
| `MASTER_SYNCED` | A branch padrão local foi atualizada após o merge |

O VS Code exibe somente o worktree aberto. Enquanto a frente estiver isolada, abra o caminho informado para vê-la; no workspace principal ela aparecerá depois de `MERGED` e `MASTER_SYNCED`.

Consulta local, somente leitura:

```bash
npm run status:change -- --branch "feature/NA-XXXX-YYYYMMDD-keywords" --base "$BASE_SHA"
```

O comando não consulta o GitHub. Sem API/CLI autenticada ou URL verificada, `PR_OPEN` permanece como validação manual.

Validação local:

```bash
npm run test:change-governance
npm run test:change-status
npm run validate:change -- --branch "$BRANCH" --base "$BASE_SHA" --head "$HEAD_SHA"
```
