Tarefa: implementar ou ajustar feature de hosts.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-lite.md`
4. `ai/modules/ssh.md`
5. `ai/modules/auth.md` se houver permissao ou visibilidade

Regras-chave:
- escopos `personal`, `team` e `global`
- usuario sem permissao nao cadastra ou edita host
- auth do host pode ser `password`, `PEM` ou referencia `op://...`
- bastion pode existir por grupo ou por host

Arquivos provaveis:
- backend: `modules/hosts`, `modules/bastions`, `modules/integrations`
- frontend: views e formularios de hosts
- shared: schemas e tipos
