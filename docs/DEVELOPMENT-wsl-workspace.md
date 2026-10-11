# Desenvolvimento no WSL e backup OneDrive

## Pasta de trabalho

Nesta máquina, use **`/home/jeferson/projects/NodeAccess-current`** para editar o
código, executar Git/npm, abrir o VS Code conectado ao WSL e iniciar o agente.
O caminho usa `projects` no plural e `NodeAccess` com essa grafia; Linux diferencia
maiúsculas de minúsculas. A migração retirou o trabalho ativo do disco `/mnt/d`.

| Local | Responsabilidade |
|---|---|
| `/home/jeferson/projects/NodeAccess-current` | Worktree ativo com a aplicação, dependências e configurações locais. |
| `/home/jeferson/projects/NodeAccess` | Checkout histórico preservado e repositório Git que mantém os metadados dos worktrees. |
| `/home/jeferson/nodeaccess-workspace` | Suporte do ambiente: launcher, toolchain, configuração/agendamento de backup, relatórios e arquivo do VS Code. |
| `NodeAccess-WSL-Backup` no OneDrive | Arquivos completos/incrementais e metadados para restauração. |
| Pasta antiga `NodeAccess` no OneDrive | Cópia anterior preservada; não é o checkout ativo. |

`nodeaccess-workspace` não é uma segunda cópia do código. Seu comando `bin/dev`
entra na `NodeAccess-current` e seleciona Node 24.21.0/npm 11.12.1 para o processo.
O arquivo `NodeAccess.code-workspace` abre o ambiente no VS Code.
Não remova o checkout histórico Linux: a `current` é um worktree e depende dos
metadados Git dele. Não remova a pasta de suporte: isso afetaria launcher e backup.

## Executar

```bash
cd /home/jeferson/projects/NodeAccess-current
/home/jeferson/nodeaccess-workspace/bin/dev npm run dev
```

Para uma sessão com o toolchain selecionado:

```bash
/home/jeferson/nodeaccess-workspace/bin/dev
node -v
npm -v
npm run dev
```

Use seu usuário normal, sem `sudo`. O dev lê `apps/backend/.env`; o `.env` da raiz
atende ao Compose. Não sobrescreva esses arquivos para atualizar uma branch.
Confira [recursos locais](OPERATIONS-dev-resources.md) e
[warm-up](DEVELOPMENT-warmup-lite.md) quando houver lentidão ou falha de início.

## Branches e documentação

A pasta `current` mantém o mesmo caminho ao trocar de branch. Seu nome não indica
que está na `master`. Confirme o estado antes de iniciar uma nova frente:

```bash
git status --short --branch
git branch --show-current
git log -1 --oneline
```

Após um PR integrado, com o trabalho local preservado e sem alterações pendentes:

```bash
git fetch origin
git switch master
git merge --ff-only origin/master
```

Não force essas operações se houver alterações locais ou divergência. Preserve
a branch anterior e comece novas mudanças em uma branch própria. Atualize README,
guias operacionais e manual quando o comportamento/instruções mudarem; planos e
evidências históricos conservam os SHAs e resultados da época. O backlog atual
fica em [engineering-backlog.md](engineering-backlog.md).

## Backup e OneDrive

O timer do WSL executa o backup a cada 15 minutos enquanto a distribuição está
ativa. O suporte guarda uma cópia estável e gera arquivos GNU tar + zstd completos
e incrementais com SHA-256 no destino Windows. Inclui `current`, demais worktrees,
Git, arquivos não commitados e configurações locais. `node_modules` é reinstalável
e não entra; volumes Docker e bancos ativos exigem backup próprio.

Esse fluxo é uma cópia de segurança de Linux para OneDrive, não edição bidirecional
de arquivos soltos. O WSL verifica a cópia no disco Windows; o envio à nuvem depende
do cliente OneDrive aberto e sincronizado. Confira o indicador no Windows.

```bash
systemctl status nodeaccess-workspace-backup.timer
python3 /home/jeferson/nodeaccess-workspace/bin/backup.py status
```

Para rotinas de backup/restauração, exclusões e retenção, consulte
`/home/jeferson/nodeaccess-workspace/LEIA-ME.txt`. A restauração exige uma pasta nova
e verifica a cadeia de checksums. Backups incluem configurações privadas e não
devem ser publicados no repositório ou compartilhados como artefatos públicos.
