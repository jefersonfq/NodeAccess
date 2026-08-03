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

Validação local:

```bash
npm run test:change-governance
npm run validate:change -- --branch "$BRANCH" --base "$BASE_SHA" --head "$HEAD_SHA"
```
