# Mudanças, registros IA e recuperação

## Rotina de implementação

Trabalhe em `/home/jeferson/projects/NodeAccess-current`, em uma branch por Change ID.
O plano fica em `docs/changes/AAAA/MM/NA-NNNN-assunto/plan.md`. Desde NA-0055, a IA
mantém `implementation.md` ao lado: intenção, decisões, arquivos, testes reais,
riscos, recuperação e um diário datado de cada interação relevante. Dúvidas que
mudem decisões também entram. Não copiar conversas completas, segredos ou dados
pessoais. O CI verifica estrutura e presença; não consegue comprovar a veracidade
de texto nem acessar conversas que a IA não registrou.

Use [o índice das mudanças](changes/README.md), branches e PRs para localizar
implementações. O próprio Git preserva o documento de cada versão. Não tente
colocar o hash do commit dentro dele mesmo: o PR, check e tag registram o SHA final.
Documente testes como Ran, Skipped, Planned ou Manual, com evidência correspondente.
Homologação humana nunca é inferida do CI.

## Proteções GitHub

Configuração declarativa em `.github/governance/`: master exige PR, conversas
resolvidas, checks obrigatórios do GitHub Actions e base atualizada, bloqueando
force-push e exclusão. Merge commit preserva a ancestralidade das branches;
branches não são apagadas automaticamente. Tags `checkpoint/*`, `v*` e `agent-v*`
não podem ser alteradas ou excluídas. Não há bypass configurado.

Aprovação humana obrigatória está em zero para permitir o fluxo autônomo solicitado;
revisão técnica independente continua exigida pelo processo IA. Há outro colaborador
com acesso de escrita, mas exigir sua aprovação dependerá de participação humana.
Os snapshots anteriores e GETs de verificação ficam no relatório privado da mudança.
Arquivos JSON sozinhos não aplicam configurações: confira as regras efetivas no GitHub.

## Checkpoints de código

Depois do merge, com master limpa e sincronizada após `git fetch origin`:

```bash
node scripts/recovery.mjs checkpoint NA-0055
# Use a tag exata retornada pelo comando:
git push origin refs/tags/checkpoint/NA-0055-SHA_CURTO
node scripts/recovery.mjs list
node scripts/recovery.mjs inspect checkpoint/NA-0055-SHA_CURTO
```

A tag anotada registra commit e tree, recusa árvore suja e nunca substitui tag.
Ela não publica release nem inicia deploy. Todo commit preservado pode ser consultado;
checkpoints dão nomes aos marcos revisados. Versões antigas sem pacote/backup não
passam a ser instalações recuperáveis apenas porque receberam uma tag.

## Recuperar código sem afetar o desenvolvimento

```bash
node scripts/recovery.mjs restore-code REFERENCIA /home/jeferson/projects/NodeAccess-recuperacao
```

O destino precisa ser novo, fora do checkout. O comando cria um worktree detached
no commit resolvido, sem trocar a branch ativa ou copiar `.env` e dependências.
É um checkout de inspeção: não executar a aplicação contra dados atuais antes de
validar a compatibilidade. O worktree compartilha Git com o repositório original;
precisa de backup próprio/configuração do backup caso seja mantido para trabalho.
Para desenvolver uma correção, criar uma branch apropriada no worktree.

Para desfazer uma implementação já integrada, criar nova branch a partir da master
atual e fazer `git revert -m 1 SHA_DO_MERGE`, revisar conflitos e executar os testes
antes do novo PR. Não usar reset/force-push. Rever dependências entre mudanças:
reverter um merge antigo não garante compatibilidade com mudanças posteriores.

## Release e retorno operacional

`build-release.sh` recusa versão inválida ou destino existente antes de preparar
artefatos. Use versão nova; nunca sobrescreva pacote anterior. O pacote contém
`release-provenance.json`: commit/tree, estado da fonte, hashes de lock/schema/
migrations e IDs/digests das imagens empacotadas. Fonte dirty/sem Git é recusada;
`NODEACCESS_RELEASE_ALLOW_UNVERIFIED_SOURCE=true` é apenas opção explícita para
pacote de desenvolvimento, marcado como não verificado. Não é release homologada.

Preservar em armazenamento durável: pacote completo, checksums/assinaturas, imagens
necessárias, configurações e chaves em cofre, backup de banco, auditoria e avatares.
Artefatos do Actions expiram e não são arquivo permanente. Publicar release de
produto somente depois da homologação; a assinatura Windows real segue pendente.

Antes de update/rollback, usar `REQUIRE_STATEFUL_BACKUPS=true` e conferir os manifests
com os scripts de backup/DR existentes. `rollback-nodeaccess.sh` troca aplicação e
reaplica migrations da versão alvo; **não desfaz migrations já aplicadas**.
Não baixar série MySQL/major Redis usando o mesmo volume. Se schema/configuração
forem incompatíveis, restaurar o backup correspondente em volumes/ambiente isolados,
validar login, tenants, terminal e dados, então planejar a troca. Restaurar backup
antigo pode perder gravações feitas depois dele; decidir isso com o responsável.

O ensaio automatizado valida recuperação do código e integridade do pacote.
Restauração operacional de uma release exige seus artefatos e dados compatíveis.

## Auditoria histórica

```bash
SECURITY_HISTORY_OUTPUT_DIR=/caminho/privado/auditoria node scripts/security/history-secrets.mjs
```

Exige histórico completo local e Docker, usa scanner fixado por digest sem rede e
redação integral dos segredos. Exit 0: sem achados; 1: triagem necessária; 2: inconclusivo.
Não publicar relatórios brutos mesmo redigidos: caminhos/metadados podem ser privados.
Não há allowlist histórica automática. Executar após fetch das refs disponíveis;
objetos apagados/prunados e refs inacessíveis não estão cobertos.
