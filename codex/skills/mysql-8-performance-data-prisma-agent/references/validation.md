# Independent Database Change Validation

## Mission

Attempt to disprove the proposed improvement. Test functional correctness and search for regressions in writes, concurrency, locks, replication, disk, memory, durability, and application compatibility.

Do not inherit the proposer's confidence. Use raw baseline, proposal, schema/config, workload, and constraints. State missing evidence.

## Validation levels

### Level 1 — Static and logical

Use for reviews and low-risk non-destructive changes. Validate syntax, semantics, types, constraints, ordering, command correctness, expected result, and recovery syntax.

### Level 2 — Execution plan

Use for queries and indexes. Compare `EXPLAIN` and safe `EXPLAIN ANALYZE`: estimated/actual rows, access method, join order, temp/sort, index use, execution time, and logical work.

### Level 3 — Representative benchmark

Use for query/index/batch/Prisma hot-path changes. Match volume, distribution, selectivity, index size, hot/cold ranges, concurrency, and query mix. Compare repeated A/B runs under equivalent cache conditions.

### Level 4 — Concurrency and load

Use for hot APIs, transactions, locks, pool changes, batch writes, reports, or busy-table indexes. Use an authorized non-production target. Measure throughput, average/p50/p95/p99, errors, CPU, disk latency/IOPS, buffer pressure, locks/deadlocks, active threads, temp tables, replica lag, and pool saturation.

### Level 5 — Migration rehearsal

Use for large DDL, conversions, partitioning, backfills, populated foreign/unique keys, rebuilds, or destructive migrations. Match schema, data, MySQL version/config, command, and compatibility path. Measure duration, lock time, disk/redo/binlog growth, lag, CPU/I/O, failure, restartability, and recovery.

## Load safety gate

Before levels 3–5 identify target and confirm it is not production unless explicitly authorized; confirm mutation allowance, backup/cleanup, maximum concurrency/duration, metrics, dependencies, start/stop criteria, and data integrity checks.

Stop on unsafe disk, uncontrolled latency/errors, threatening locks, excessive lag, sustained resource saturation, uncertain integrity, or any agreed threshold.

Use existing tooling where possible: application harnesses, Prisma integration tests, `sysbench`, `mysqlslap`, k6/JMeter, or a bounded custom SQL harness. Match the tool to the workload; generic OLTP does not prove application behavior.

## Acceptance and report

Define maximum p95/p99, minimum throughput, maximum errors/locks/lag/CPU/disk latency/migration duration/downtime, and integrity expectations before running.

Report risk, level, environment, dataset, workload, baseline, after result, resource/lock/replication effects, pass/fail, limitations, recovery result, and production classification. Mark each check Ran, Skipped, Planned, or Manual.
