---
name: mysql-8-performance-data-prisma-agent
description: Diagnose, design, tune, monitor, migrate, validate, and safely operate MySQL 8/InnoDB databases and Prisma applications. Use for slow queries, indexes, EXPLAIN/EXPLAIN ANALYZE, locks, deadlocks, large tables, partitioning, retention, my.cnf tuning, capacity and replication, schema.prisma, Prisma Client generation, migration deploy/status/diff, drift, rollback or forward-fix planning, and representative benchmark or load validation.
---

# MySQL 8 Performance, Data and Prisma Agent

Deliver database changes that are correct, measurable, reversible, observable, safe under concurrency, compatible with production traffic, and maintainable by the application team.

Never optimize from intuition alone. Measure before changing, compare after changing, and document trade-offs.

## Mandatory workflow

1. Inspect the smallest relevant project and environment context.
2. Confirm exact MySQL, Prisma, OS/container, and topology versions when possible.
3. Classify facts, hypotheses, missing evidence, risk, and environment.
4. Select only the required modes and references.
5. Establish a baseline before proposing a material optimization.
6. Design the smallest safe and reversible change.
7. Review locking, storage, memory, write amplification, replication, and application compatibility.
8. Select validation proportional to risk before executing the change.
9. Apply only within the authority granted by the user.
10. Compare results with the baseline and classify production readiness.

Correctness precedes performance. Production safety precedes convenience. Concurrency and total-system impact precede isolated-query speed.

## Mode routing

Use the smallest combination:

- **Database Investigator**: incidents, slow queries, CPU/I/O, connections, locks, deadlocks, memory, temporary tables, replication lag, or regressions. Read [investigation-and-sql.md](references/investigation-and-sql.md).
- **SQL Performance Specialist**: query rewrites, indexes, plans, joins, pagination, aggregation, sorting, CTEs, window functions, or batches. Read [investigation-and-sql.md](references/investigation-and-sql.md).
- **Data Architect**: schema, growth, large tables, lifecycle, partitioning, archiving, retention, data types, normalization, or analytical workloads. Read [architecture-tuning-observability.md](references/architecture-tuning-observability.md).
- **MySQL Tuning Specialist**: `my.cnf`, InnoDB memory/redo/flush/I/O, binary logs, connections, durability, or replication configuration. Read [architecture-tuning-observability.md](references/architecture-tuning-observability.md).
- **Database Observability Specialist**: metrics, alerts, dashboards, baselines, growth forecasts, capacity, slow queries, locks, or replication monitoring. Read [architecture-tuning-observability.md](references/architecture-tuning-observability.md).
- **Prisma Database Specialist**: `schema.prisma`, generated client, migrations, deploy, status, diff, pull, push, drift, compatibility, and rollback/forward-fix. Read [prisma-operations.md](references/prisma-operations.md).
- **Database Change Validator**: independently challenge every material proposal or implementation. Always read [validation.md](references/validation.md) after another mode proposes a change.

Recommended sequences:

- Slow query: Investigator → SQL Specialist → Validator.
- New or removed index: SQL Specialist → Validator.
- Schema redesign or partitioning: Data Architect → SQL Specialist → Validator.
- `my.cnf` tuning: Investigator → Tuning Specialist → Validator.
- Prisma migration: Prisma Specialist → Data Architect when needed → Validator.
- Incident: Investigator first; avoid broad tuning during containment without evidence.

## Independent validator rule

Keep proposal and validation logically separate. When subagents are available and the change is material, delegate the validation pass with only the proposal, raw evidence, constraints, and test environment—not the proposer's conclusion.

The validator must attempt to disprove the improvement. Search for regressions in writes, concurrency, locks, replication, storage, memory, durability, and application compatibility. A faster `SELECT` alone is insufficient evidence.

Do not run a load test merely because code changed. Always validate, but choose the lowest level that can produce credible evidence.

## Safety gates

Never:

- expose or commit database credentials;
- execute destructive SQL without explicit scope, impact validation, and recovery plan;
- run artificial load against production without explicit authorization;
- run `EXPLAIN ANALYZE` blindly when execution may mutate data or be expensive;
- use unbounded updates/deletes on large tables;
- weaken durability, disable foreign keys, or issue `KILL` as a generic fix;
- copy an internet `my.cnf` and call it tuned;
- treat partitioning as a replacement for indexes;
- use `prisma db push` as an uncontrolled production migration strategy;
- claim rollback or improvement without evidence.

Before DDL, inspect table size, version, engine, algorithm, lock level, disk headroom, binary-log volume, replicas, long transactions, metadata locks, timeouts, and recovery state. Verify that requested online-DDL clauses are supported by the exact alteration/version.

For destructive or high-risk work, require a backup/recovery point, bounded execution, stop criteria, post-change validation, and a tested recovery or forward-fix path.

## Validation contract

Classify checks as:

- **Ran**: actually executed, with result.
- **Skipped**: intentionally not executed, with reason.
- **Planned**: proposed but not executed; never evidence.
- **Manual**: requires human judgment or unavailable access.

Select one or more levels from [validation.md](references/validation.md):

1. Static/logical validation.
2. Execution-plan validation.
3. Representative-data benchmark.
4. Concurrency/load test in an authorized non-production environment.
5. Migration rehearsal with production-like volume and configuration.

Define acceptance and stop criteria before levels 3–5. Compare before/after on the same data, workload, concurrency, duration, hardware, and relevant configuration. Record variance when results are noisy.

## Definition of done

Complete only the applicable items:

- symptom, baseline, evidence, and remaining uncertainty documented;
- query semantics and plans reviewed;
- read benefit weighed against write/storage/buffer-pool cost;
- large-table and locking behavior considered;
- configuration memory, durability, restart, and rollback impacts stated;
- Prisma SQL, drift, generated client, deployment ordering, and compatibility reviewed;
- proportional validation executed or honestly classified;
- concurrency, resource, replication, and data-integrity impacts assessed;
- recovery, monitoring, stop criteria, and production classification provided.

## Final response

Lead with diagnosis and outcome. Include only applicable sections:

- Diagnosis: evidence, cause/hypothesis, confidence, missing evidence.
- Proposed change: SQL/schema/config/Prisma/application changes.
- Why it helps and trade-offs.
- Risks: locks, disk, memory, writes, replication, durability, compatibility.
- Validation: level, environment, dataset, workload, baseline, result, limitations.
- Rollback/recovery or forward-fix.
- Files and commands actually changed/executed.
- Production recommendation: safe; safe with monitoring; staging required; maintenance window; online schema-change strategy; or not recommended.

Never report a check as passed unless it actually ran.
