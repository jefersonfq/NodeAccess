# Prisma Database Operations

## Contents

- Context inspection
- Command semantics
- Migration review
- Safe deployment patterns
- Rollback reality
- Deployment checklist

## Context inspection

Inspect Prisma and MySQL versions, datasource/generator, `schema.prisma`, migration history, deployment/CI commands, shadow database, drift, multiple app instances, and backward-compatibility requirements.

Treat Prisma migrations as database changes, not merely application files.

## Command semantics

- `npx prisma generate`: generate the client; validate output paths, caches, build/runtime imports, and application compilation.
- `npx prisma migrate dev`: development-oriented; may create/apply migrations, use a shadow DB, detect drift, and regenerate. Do not make it the default production command.
- `npx prisma migrate deploy`: apply pending migrations in controlled deployments; it does not make unsafe SQL safe.
- `npx prisma migrate status`: inspect applied/pending/diverged state.
- `npx prisma migrate diff`: inspect or generate schema differences/SQL.
- `npx prisma db pull`: introspect carefully; preserve intentional mappings and annotations.
- `npx prisma db push`: restrict to prototypes or explicitly controlled cases, not auditable production migration replacement.

## Migration review

Inspect generated SQL for table rebuild/copy, blocking DDL, conversions, data loss, drops, keys/unique constraints, defaults/nullability, charset/collation, backfills, metadata locks, disk, binlogs, and replication.

Estimate duration and lock exposure with representative volume. Confirm only one deployment process applies migrations.

## Safe deployment patterns

Prefer expand-and-contract:

1. Add a backward-compatible nullable structure.
2. Deploy code capable of old and new formats.
3. Backfill in bounded, restartable batches.
4. Validate counts/content and replication.
5. Switch reads/writes.
6. Enforce constraints.
7. Remove obsolete structure in a later deployment.

Do not couple destructive removal to the first application deployment.

## Rollback reality

Prisma does not guarantee safe down migrations. Recovery may require application rollback, forward-fix, restored objects/data, feature flags, dual-write, blue-green, snapshots, or point-in-time recovery. Never call a change reversible without evaluating data implications and practicing the path when risk warrants it.

## Deployment checklist

Before: status, SQL review, recovery point, duration, locking, disk, replication, compatibility with old/new clients, backfill, recovery/forward-fix, representative rehearsal, `prisma generate`, and migration ownership.

After: migration table, startup/client compatibility, error rate, latency, locks, CPU/I/O, replica lag, and affected-data validation.

Report files, SQL analysis, commands, locks, compatibility window, backfill, recovery, test strategy, and monitoring.
