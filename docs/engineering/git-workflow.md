# Fluxo de mudanças do NodeAccess

Cada frente nova possui exatamente um Change ID, um plano versionado e uma branch. Alterações já implementadas antes da adoção deste fluxo são preservadas; todo trabalho iniciado a partir de NA-0001 segue estes gates.

1. Criar `docs/changes/YYYY/MM/NA-XXXX-keywords/plan.md`.
2. Registrar situação anterior, objetivo, escopo, critérios, riscos, baseline, testes e rollback.
3. Atualizar `master` a partir de `origin/master`, criar `<tipo>/NA-XXXX-YYYYMMDD-keywords` dessa base e entrar na branch na pasta principal.
4. Implementar apenas o escopo aprovado e atualizar testes junto do código.
5. Executar validação proporcional e o harness no último SHA.
6. Usar commits convencionais com Change ID e trailers `Plan`, `Change-Date` e `Tests`/`Evidence`.
7. Abrir PR com antes, implementado, depois, riscos e evidências.
8. Mesclar somente após checks e homologação humana.
9. Sincronizar a `master` local imediatamente após o merge e confirmar `MASTER_SYNCED`.

Para trabalho sequencial, use a branch da frente na pasta principal aberta pelo VS Code. Assim, novos arquivos e alterações ficam visíveis imediatamente sem perder o isolamento e a recuperabilidade da branch. Use `git worktree` somente para frentes realmente paralelas ou quando alterações locais de outra frente precisarem ser preservadas. A branch padrão é `master`, que deve rastrear `origin/master`. Push direto, force push e merge direto em `master` não fazem parte deste fluxo.

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

O VS Code exibe os arquivos da branch ativa no diretório aberto. No fluxo sequencial, troque a pasta principal para a branch da frente e mantenha-a ativa até concluir ou abandonar o assunto. Se uma worktree paralela for necessária, abra seu caminho explicitamente; a pasta principal não exibirá esses arquivos antes do merge e da sincronização.

Transição sequencial recomendada:

```bash
git switch master
git pull --ff-only
git switch -c <tipo>/NA-XXXX-YYYYMMDD-keywords
```

Ao terminar, valide e solicite commit/publicação. Não abra a próxima branch enquanto a atual tiver trabalho sem destino definido.

## Encerramento obrigatório

Uma frente não termina em `COMMITTED` ou `PUSHED`. Ao concluir uma interação, informe todos os estados e deixe explícito o gate pendente. Classifique como entregue apenas quando `MERGED` e `MASTER_SYNCED` estiverem completos.

Existem somente dois encerramentos válidos:

1. **Entregue:** PR aprovado e mesclado, seguido de sincronização da `master` local.
2. **Abandonado:** decisão humana explícita; branch e worktree continuam recuperáveis até autorização separada para remoção.

Antes de abrir uma nova frente, verifique se a anterior está entregue, abandonada ou declaradamente pendente. Não trate uma branch apenas enviada ao remoto como concluída.

Configuração local esperada:

```bash
git branch --set-upstream-to=origin/master master
git remote set-head origin master
```

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
