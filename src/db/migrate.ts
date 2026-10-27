import { z } from "zod";

import { type Database, type SqlRow, type Statement, sql } from "./database";

export type Migration = {
  /** Sortable unique name, such as `0001_initial`. */
  readonly name: string;
  /**
   * SQL statements separated by `--> statement-breakpoint` lines.
   *
   * Each part must hold exactly one statement.
   * SQLite and D1 compile only the first statement of a part and ignore the rest.
   */
  readonly text: string;
};

const breakpoint = /^\s*--> statement-breakpoint\s*$/m;
const migrationName = /^\d{4}_[a-z0-9_]+$/;

const createMigrationsTable = sql(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT
`);

const migrationRow = z.object({ name: z.string() });

const decodeName = (row: SqlRow): string => migrationRow.parse(row).name;

/** Splits a migration file into statements, because a batch runs exactly one statement per entry. */
export const splitStatements = (text: string): Statement[] => {
  const statements: Statement[] = [];

  for (const part of text.split(breakpoint)) {
    const trimmed = part.trim();

    if (trimmed !== "") {
      statements.push(sql(trimmed));
    }
  }

  return statements;
};

const checkOrder = (migrations: readonly Migration[]): void => {
  let previous = "";

  for (const { name } of migrations) {
    if (!migrationName.test(name)) {
      throw new Error(`Migration name "${name}" does not match NNNN_snake_case`);
    }

    if (name <= previous) {
      throw new Error(`Migration "${name}" is not after "${previous}"`);
    }

    previous = name;
  }
};

/**
 * Applies every pending migration and its `schema_migrations` row in one batch, and returns the applied names.
 *
 * The run is all or nothing: a failed statement leaves the database unchanged.
 * The run stops when the database records a migration that the code does not know.
 */
export const migrate = async (
  db: Database,
  migrations: readonly Migration[],
): Promise<string[]> => {
  checkOrder(migrations);
  await db.run(createMigrationsTable);

  const applied = new Set(await db.all(sql("SELECT name FROM schema_migrations"), decodeName));
  const known = new Set(migrations.map(({ name }) => name));

  for (const name of applied) {
    if (!known.has(name)) {
      throw new Error(
        `Database has unknown migration "${name}". Update the code before you continue.`,
      );
    }
  }

  const pending: Migration[] = [];
  const statements: Statement[] = [];

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      pending.push(migration);
      statements.push(...splitStatements(migration.text));
      statements.push(sql("INSERT INTO schema_migrations (name) VALUES (?)", [migration.name]));
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return pending.map(({ name }) => name);
};
