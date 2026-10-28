import type { D1Binding, D1PreparedStatement, D1Row } from "../cloudflare/bindings";
import type { Database, SqlRow, SqlValue, Statement } from "./database";

/** D1 rejects a statement with more bound parameters than this. */
export const d1MaxParams = 100;

const toBinding = (value: SqlValue): string | number | null | ArrayBuffer =>
  value instanceof Uint8Array ? value.slice().buffer : value;

const toRow = (row: D1Row): SqlRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      Array.isArray(value) ? Uint8Array.from(value) : value,
    ]),
  );

/** The `Database` contract on Cloudflare D1. `batch` runs inside one D1 transaction. */
export const createD1Database = (d1: D1Binding): Database => {
  const prepare = (statement: Statement): D1PreparedStatement => {
    if (statement.params.length > d1MaxParams) {
      throw new Error(
        `D1 allows ${d1MaxParams} bound parameters, but the statement has ${statement.params.length}`,
      );
    }

    const prepared = d1.prepare(statement.text);

    return statement.params.length === 0
      ? prepared
      : prepared.bind(...statement.params.map(toBinding));
  };

  return {
    all: async (statement, decode) =>
      (await prepare(statement).all()).results.map((row) => decode(toRow(row))),
    first: async (statement, decode) => {
      const [row] = (await prepare(statement).all()).results;

      return row === undefined ? undefined : decode(toRow(row));
    },
    run: async (statement) => ({ changes: (await prepare(statement).run()).meta.changes }),
    batch: async (statements) =>
      statements.length === 0
        ? []
        : (await d1.batch(statements.map(prepare))).map((result) => ({
            changes: result.meta.changes,
          })),
    close: async () => undefined,
  };
};
