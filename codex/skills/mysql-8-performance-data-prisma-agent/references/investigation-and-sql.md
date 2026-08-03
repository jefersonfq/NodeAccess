# Investigation and SQL Performance

## Contents

- Investigation context and evidence
- Targeted diagnostics
- Query and plan workflow
- Index design and query patterns
- Transactions and locking
- Deliverables

## Investigation context and evidence

Collect only what the symptom requires: exact versions, CPU/RAM/container limits, disk and latency, database/table/index sizes, read/write rates, peak connections and pool sizing, replication/backup topology, Prisma/application versions, incident timing, workload pattern, and recent deploys or migrations.

Do not treat `SHOW PROCESSLIST` as a complete diagnosis. Distinguish confirmed evidence from hypotheses.

Investigate as applicable: CPU or storage saturation; buffer-pool misses; excessive rows examined; disk temporary tables; filesort; full scans; missing/redundant indexes; metadata/row locks; deadlocks; long transactions; connection churn; replica lag; undo/purge/checkpoint pressure; large DDL; or application retry storms.

## Targeted diagnostics

Choose the narrowest relevant subset:

```sql
SELECT VERSION();
SHOW FULL PROCESSLIST;
SHOW ENGINE INNODB STATUS\G

SELECT *
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;

SELECT * FROM sys.statement_analysis
ORDER BY total_latency DESC LIMIT 20;

SELECT * FROM sys.schema_table_statistics
ORDER BY total_latency DESC LIMIT 20;

SELECT * FROM sys.innodb_lock_waits;
SELECT * FROM performance_schema.data_locks;
SELECT * FROM performance_schema.data_lock_waits;
```

Do not request every command mechanically or expose sensitive statement literals.

## Query and plan workflow

Inspect purpose, frequency, result size, rows examined, selectivity, join cardinality/order, predicates, grouping, sorting, temporary tables, conversions/collations, pagination, concurrency, and write impact.

Use as appropriate:

```sql
EXPLAIN FORMAT=TREE SELECT ...;
EXPLAIN FORMAT=JSON SELECT ...;
EXPLAIN ANALYZE SELECT ...;
```

`EXPLAIN ANALYZE` executes the statement. Confirm safety and cost; prefer a replica/staging or bounded query for expensive work. Compare estimated and actual rows. Large differences may indicate stale statistics, skew, correlation, expressions, weak selectivity assumptions, or a useful histogram.

## Index design and query patterns

Evaluate equality, range, joins, ordering/grouping, leftmost prefix, covering value, width, cardinality, uniqueness, foreign keys, redundancy, data distribution, storage, buffer-pool impact, and write amplification.

Do not index every `WHERE` column. Verify the actual workload. Consider invisible indexes before dropping a candidate:

```sql
ALTER TABLE example ALTER INDEX idx_example INVISIBLE;
ALTER TABLE example ALTER INDEX idx_example VISIBLE;
```

Consider histograms for skewed non-indexed columns, never as a substitute for a necessary index. Avoid `SELECT *`, leading wildcards, functions on indexed predicates, implicit conversions, unnecessary `DISTINCT`, N+1, correlated repeated subqueries, huge `IN`, missing joins, row-by-row processing, and unbounded batches.

Prefer keyset pagination over very large offsets, using every deterministic ordering column in the cursor.

## Transactions and locking

Review isolation, duration, access order, rows and gaps locked, foreign keys, batch size, retry policy, and external/user work inside transactions. Never hold a transaction while waiting for user input, external APIs, files, or long processing.

For deadlocks, capture both transactions, compare access order and indexes, shorten transactions, and use bounded retries only as a complementary measure.

## Deliverables

Report the symptom, evidence, primary and alternative causes, containment, proposed query/index, plan interpretation, expected benefit, write/storage cost, validation, rollback, and production risk.
