# NA-0029 — Resultados de teste

Data: 2026-08-11

- suíte completa do módulo de autenticação: 150 testes aprovados;
- testes finais de repositório, isolamento e rotas administrativas: 14 aprovados;
- Prisma schema validation: aprovado;
- shared e backend typecheck/build: aprovados;
- frontend typecheck e build de produção: aprovado (3.279 módulos);
- migration `20260811204500_add_oidc_group_mappings`: aplicada com sucesso no MySQL local;
- backup pré-migration validado em `backups/na0029-validation/nodeaccess-mysql-sshplatform-pre-na0029.sql.gz`;
- `git diff --check`: aprovado.
