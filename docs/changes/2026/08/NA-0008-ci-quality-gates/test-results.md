# Resultados de validação — NA-0008

Data: 2026-08-05 (America/Sao_Paulo)

## Resultado

Status local: PASS, aguardando commit para executar a governança contra o SHA final e os checks do GitHub.

| Verificação | Resultado | Evidência |
|---|---|---|
| Prisma Client | PASS | npm run db:generate -w apps/backend |
| Shared package | PASS | npm run build -w packages/shared |
| Lint incremental tipado | PASS | 6 arquivos alterados, zero erros e zero avisos |
| Typecheck | PASS | backend e frontend |
| Testes completos | PASS | 36 arquivos, 363 testes |
| Teste direcionado de importação | PASS | 4 testes |
| Build de produção | PASS | backend e frontend; 3.259 módulos frontend transformados |
| Governança unitária | PASS | 4 testes |
| Integridade do diff | PASS | git diff --check |
| Revisão independente | PASS | três bloqueadores iniciais corrigidos; nenhum novo bloqueador |

## Antes e depois

Antes, o CI não gerava o Prisma Client nem o pacote compartilhado, não recebia os fontes do módulo de logs e aplicava um lint global sobre dívida histórica. O mock de importação também não atendia o schema HTTP vigente.

Depois, o workflow prepara explicitamente os artefatos gerados, executa lint tipado e estrito sobre o diff do PR, versiona somente os fontes TypeScript necessários e valida os contratos atuais da importação.

## Limitações

- O repositório possui dívida histórica de lint fora do escopo: 1.007 ocorrências no backend (436 erros e 571 avisos).
- O lint completo permanece disponível como npm run lint; o quality gate incremental não oculta falhas em arquivos modificados.
- A validação real de plano, commit, PR e SHA só pode ser concluída depois do commit.
- O build mantém um aviso não bloqueante de chunk do frontend acima de 950 kB.
