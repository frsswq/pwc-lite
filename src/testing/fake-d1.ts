import type { D1Binding, D1PreparedStatement, D1Result, D1Row } from "../cloudflare/bindings";
import { type Database, type SqlRow, type SqlValue, type Statement, sql } from "../db/database";

/** D1 returns a BLOB as an array of bytes, so the fake does the same. */
const toD1Row = (row: SqlRow): D1Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Uint8Array ? [...value] : value,
    ]),
  );

const keepRow = (row: SqlRow) => row;

/**
 * A D1 binding that runs on a local SQLite `Database`.
 *
 * It follows the D1 behavior that pwc-lite depends on: BLOB values come back as byte arrays,
 * `batch` is one transaction, and a statement may have at most 100 bound parameters.
 */
export const fakeD1 = (db: Database): D1Binding => {
  const statements = new WeakMap<D1PreparedStatement, Statement>();

  const prepare = (text: string, params: readonly SqlValue[]): D1PreparedStatement => {
    const prepared: D1PreparedStatement = {
      bind: (...values) => {
        if (values.length > 100) {
          throw new Error("D1_ERROR: too many SQL variables");
        }

        return prepare(
          text,
          values.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)),
        );
      },
      all: async (): Promise<D1Result> => ({
        results: (await db.all(sql(text, params), keepRow)).map(toD1Row),
        meta: { changes: 0 },
      }),
      run: async (): Promise<D1Result> => ({
        results: [],
        meta: { changes: (await db.run(sql(text, params))).changes },
      }),
    };

    statements.set(prepared, sql(text, params));

    return prepared;
  };

  return {
    prepare: (text) => prepare(text, []),
    batch: async (entries) => {
      const results = await db.batch(
        entries.map((entry) => {
          const statement = statements.get(entry);

          if (statement === undefined) {
            throw new Error("The statement is not from this D1 binding");
          }

          return statement;
        }),
      );

      return results.map(({ changes }) => ({ results: [], meta: { changes } }));
    },
  };
};
