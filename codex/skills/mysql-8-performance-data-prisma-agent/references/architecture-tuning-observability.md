# Data Architecture, MySQL Tuning, and Observability

## Contents

- Large tables and lifecycle
- Partitioning and archiving
- Configuration tuning
- Memory, durability, and connections
- Monitoring and capacity
- Replication awareness

## Large tables and lifecycle

Judge tables by size, active working set, growth, access pattern, retention, hot/cold data, indexes, maintenance, backup/restore, replication, DDL, and purge cost—not row count alone.

Define active/historical periods, legal/audit retention, archive destination, purge schedule, restartability, validation, restore procedure, and ownership. Prefer continuous lifecycle management.

Use appropriate data types and collations. Avoid numeric data in strings, unjustified oversized types, and JSON for relational data. Denormalize only with a proven read pattern, explicit consistency owner, understood update cost, and measured gain.

## Partitioning and archiving

Partition only when common queries filter the partition key, pruning occurs, retention benefits from dropping partitions, unique-key rules are satisfied, and partition count/operations remain manageable. Preserve necessary indexes.

Before recommending partitioning, prove benefit with the actual query and lifecycle workload. Define partition creation monitoring and failure handling.

Archive targets may be a table/schema, separate MySQL, object storage, analytical store, or compressed export. Define selection, counts/checksums, transfer, bounded deletion, throttling, audit, restart, and restore.

## Configuration tuning

Inspect active values and configuration sources; do not assume the named file is loaded. Base tuning on hardware/container limits, active data, workload, durability, storage latency, replication, backups, pools, and current metrics.

Review only relevant settings: buffer pool, redo capacity/log buffer, flush and binlog durability, flush method/I/O capacity, connections and thread cache, per-session buffers, temporary-table limits, table caches, binlog retention, slow log, Performance Schema, replica workers, timeouts, packet and file limits.

For every change, record current value, dynamic/restart status, expected effect, measurement window, estimated memory/durability impact, and rollback value. Apply one logical group at a time.

## Memory, durability, and connections

Estimate global buffers plus realistic concurrent per-session buffers, temporary tables, sort/join/read buffers, binlog caches, Performance Schema, OS cache, co-located services, and container limits. Avoid globally enlarging per-session buffers for one query.

Never weaken `innodb_flush_log_at_trx_commit` or `sync_binlog` silently. State possible committed-transaction loss and obtain authorization.

Size buffer pool from dedicated/shared host, active working set, pressure/swap, container limit, and operational overhead—not a fixed internet percentage.

Analyze active/total connections, creation rate, pool sizes across replicas, idle behavior, transactions, and timeouts. Increasing `max_connections` is not pooling.

## Monitoring and capacity

Monitor availability; connection/pool health; query latency/digests/rows examined; scans/temp tables/sorts; buffer pool, dirty pages, redo/checkpoints, locks/deadlocks/purge; disk capacity/latency/IOPS; table/index/binlog/temp growth; replication threads/lag/errors/relay logs/GTID; backup duration; and retention/archive/partition jobs.

Rank workload by aggregate latency, not only worst single execution. Enable slow logging deliberately; avoid noisy `log_queries_not_using_indexes` on busy production without evidence.

Make alerts actionable, sustained, baseline-aware, severity-based, and linked to a runbook. Forecast daily growth and time to capacity for data, indexes, binlogs, backups, connections, CPU, latency, and buffer pressure.

## Replication awareness

For material changes evaluate binlog volume, replica apply rate/lag, GTID and DDL propagation, transaction size, row-based logging, replica disk, read-after-write, and failover compatibility. Primary success with persistent replica lag is failure.
