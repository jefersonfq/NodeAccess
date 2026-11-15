# Reversão da configuração enxuta do Codex (2026-11-08)

Instrução para o Codex/agentes: execute esta reversão **somente** se o usuário pedir
explicitamente para "voltar a configuração anterior do Codex" (total ou parcial).
Os arquivos `.bak` desta pasta não são instruções ativas; não os carregue no dia a dia.

## O que mudou (NA-0173)

| Item | Antes (backup) | Depois |
|---|---|---|
| `AGENTS.md` | 13 KB com checklists de frontend/UX | ~5 KB; checklists em `ai/frontend-guidelines.md` |
| `codex/skills/nodeaccess-change-lifecycle/SKILL.md` | 12 KB | ~9 KB; seções de commit/PR/conclusão em `references/commit-and-completion.md` |
| `/root/.codex/rules/default.rules` | 1.920 regras pontuais | ~50 regras genéricas (fora do repositório) |
| `.gitignore` | sem `.tmp/` | ignora `/.tmp/` |
| `CLAUDE.md` | 1,7 KB com regras próprias | importa `@AGENTS.md` + notas do Claude |
| `.claude/settings.json`, `.claude/skills/` | inexistentes | permissões espelhadas e link da skill |
| `/root/.codex/config.toml` | — | inalterado (backup só por segurança) |

Hashes SHA-256 dos backups (para conferir integridade):

```text
bfcec290288efda20df3b3081eda36f6a72a7acd516547567921d2bbc962a449  AGENTS.md.bak
53304eda0ca295ecb7bd285fbf96802cac99f3af6bf96d4378f0f267d1aea4f3  CLAUDE.md.bak
82c5a1fb88b81766eb97e994962e2696db53a124ce25ac389886e38c9b74a9ed  gitignore.bak
3754b334418a5cfdff375522dd972bb4f0ec5ee196f6d67ff8798ed156b5d266  nodeaccess-change-lifecycle.SKILL.md.bak
a1a1aa3f39ecb5efa1f168987d091517fadd33f5ef456ac8504dc8af164647b0  /root/.codex/rules-backup/default.rules.2026-11-08.bak
e4709bcb2c21e2b9a604ae1b95891ed73019f1a2dfe6849f67bf1325d1ce19f0  /root/.codex/rules-backup/config.toml.2026-11-08.bak
```

## Reversão total

Na raiz de `/home/jeferson/projects/NodeAccess-current`:

```bash
B=ai/backup/codex-config-2026-11-08
cp $B/AGENTS.md.bak AGENTS.md
cp $B/nodeaccess-change-lifecycle.SKILL.md.bak codex/skills/nodeaccess-change-lifecycle/SKILL.md
cp $B/gitignore.bak .gitignore
cp $B/CLAUDE.md.bak CLAUDE.md
rm -f .claude/settings.json && rm -rf .claude/skills
cp /root/.codex/rules-backup/default.rules.2026-11-08.bak /root/.codex/rules/default.rules
```

Opcional (os arquivos novos ficam inofensivos se mantidos):
`ai/frontend-guidelines.md` e
`codex/skills/nodeaccess-change-lifecycle/references/commit-and-completion.md`.

Abrir uma nova sessão do Codex depois de reverter (AGENTS.md e regras são lidos no início).

## Reversão parcial

- Só as instruções: copiar apenas `AGENTS.md.bak`.
- Só as permissões: copiar apenas `default.rules.2026-11-08.bak`. O backup contém regras
  amplas como `git push origin main` permitido sem pergunta; revise antes de restaurar.
- Só a skill: copiar apenas `nodeaccess-change-lifecycle.SKILL.md.bak`.

Registrar a reversão em `docs/changes/2026/11/NA-0173-codex-token-efficiency/implementation.md`.
