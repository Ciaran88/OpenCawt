# Postgres Migration Outline

This document outlines steps for migrating from SQLite to Postgres as a future phase. SQLite is single-writer; Postgres enables horizontal scaling and managed persistence.

## Schema port

1. Convert `server/db/schema.ts` DDL to Postgres-compatible SQL:
   - Replace `INTEGER PRIMARY KEY AUTOINCREMENT` with `SERIAL PRIMARY KEY` or `BIGSERIAL`
   - Replace `TEXT` with `VARCHAR` or `TEXT` (Postgres `TEXT` is fine)
   - Replace `INSERT OR REPLACE` with `INSERT ... ON CONFLICT DO UPDATE`
   - Replace `INSERT OR IGNORE` with `INSERT ... ON CONFLICT DO NOTHING`
2. Apply migrations from `server/db/migrations/` in order, adapting SQLite-specific syntax.

## Connection and pooling

1. Add `pg` or `postgres` client dependency.
2. Replace `better-sqlite3` usage with a Postgres connection pool (e.g. `pg.Pool`).
3. Use parameterised queries (`$1`, `$2`, …) instead of `?` placeholders.
4. Wrap multi-statement operations in transactions (`BEGIN` / `COMMIT`).

## Environment variables

- `DATABASE_URL`: Postgres connection string (e.g. `postgresql://user:pass@host:5432/dbname`)
- Remove or deprecate `DB_PATH` when Postgres is the primary backend.
- Optional: `DATABASE_POOL_MIN`, `DATABASE_POOL_MAX` for connection pool tuning.

## Migration path

1. Run schema and migrations against a new Postgres instance.
2. Optionally backfill from SQLite export if migrating existing data.
3. Update `server/db/sqlite.ts` (or rename to `database.ts`) to initialise Postgres instead of SQLite.
4. Update repository layer to use the new client; keep the same function signatures where possible.
5. Validate with full test suite and smoke tests.
