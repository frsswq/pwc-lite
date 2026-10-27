import { Database as BunDatabase } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Database, RunResult, SqlRow, SqlValue, Statement } from "./database";

const inMemoryPath = ":memory:";
const busyTimeoutMs = 5000;

/** Opens a local SQLite file, or an in-memory database for `:memory:`, behind the `Database` contract. */
export const openSqliteDatabase = (path: string): Database => {
  if (path !== inMemoryPath) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new BunDatabase(path, { create: true, strict: true });

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`PRAGMA busy_timeout = ${busyTimeoutMs}`);

  // bun:sqlite returns only TEXT, INTEGER, REAL, BLOB, and NULL values, which `SqlRow` covers.
  const prepare = (statement: Statement) => db.query<SqlRow, SqlValue[]>(statement.text);

  const runOne = (statement: Statement): RunResult => {
    const { changes } = prepare(statement).run(...statement.params);

    return { changes };
  };

  const runBatch = db.transaction((statements: readonly Statement[]) => statements.map(runOne));

  return {
    all: async (statement, decode) =>
      prepare(statement)
        .all(...statement.params)
        .map(decode),
    first: async (statement, decode) => {
      const row = prepare(statement).get(...statement.params);

      return row === null ? undefined : decode(row);
    },
    run: async (statement) => runOne(statement),
    batch: async (statements) => runBatch(statements),
    close: async () => {
      db.close();
    },
  };
};
