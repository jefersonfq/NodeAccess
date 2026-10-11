# NA-0038 — Engineering hardening

- Data: 2026-10-05
- Branch: fix/NA-0038-20261005-engineering-hardening
- Estado: LOCAL_VALIDATED (sem commit/deploy); a frente NA-0037 permanece pendente e suas alterações locais foram preservadas.
- Base: workspace atual; snapshots anteriores em /tmp/nodeaccess-engineering-baseline, sem reset de mudanças preexistentes.

## Objetivo e escopo
Corrigir NA-ENG-01 a 12 do relatório docs/reviews/2026-10-05-engineering-practices-audit.md. Parser estrito de flags; consumidores independentes, leases e deduplicação de filas; deadlines e retry limitado; shutdown; headers; robustez HTTP/erro frontend; extração localizada; tamanho de respostas; quota segura de backups.

## Fora de escopo
Migração de arquitetura, dependências novas, deploy/merge automático, garantia de exactly-once em APIs externas, certificação WCAG ou carga em produção.

## Critérios e validação
Testes unitários e integração MySQL descartável para concorrência/recovery/migration; simulações de timeout/ACK perdido/shutdown; build/typecheck/lint; regressão auth/ACL/cache/SSH/SFTP; Playwright Chromium dos fluxos afetados e terminal; testes reais opt-in conforme AGENTS. Registrar números, ambiente e limites reais em test-results.md.

## Riscos e rollback
Flags false passam a ser realmente falsas, revisar perfis de ambiente. Leases não garantem deduplicação externa após ACK perdido. Migration aditiva preserva histórico, rollback de aplicação exige drenar workers e verificar tarefas PROCESSING. Não restaurar Git HEAD sobre arquivos com alterações anteriores; usar snapshot/diff específico desta rodada. Branch local não salva automaticamente alterações sem commit. Antes de deploy exigir backup/restauração validada e homologação humana; commits/publicação somente após resultado revisável.

## Fechamento
Implementações e ensaios concluídos; resultados em `test-results.md`, relatório em `docs/reviews/2026-10-05-engineering-hardening-implementation.md`. Rollback seletivo e snapshot portável documentados em `rollback.md`, com dry run e simulação isolada aprovados. NA-ENG-08 mantém CSP report-only e NA-ENG-10 é extração inicial; o restante da matriz segue roteiro condicionado a evidência. A branch nasce do workspace corrente porque trocar para master descartaria ou misturaria trabalho anterior; nada foi resetado, publicado ou implantado.
