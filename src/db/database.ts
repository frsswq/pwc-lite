/** A value that SQLite and D1 can bind as a parameter and return in a column. */
export type SqlValue = string | number | bigint | Uint8Array | null;

/** One result row before the caller decodes it into a domain type. */
export type SqlRow = Readonly<Record<string, SqlValue>>;

/** Converts one raw row into a domain type, or throws when the row does not match. */
export type RowDecoder<Row> = (row: SqlRow) => Row;

export type Statement = {
  readonly text: string;
  readonly params: readonly SqlValue[];
};

export type RunResult = {
  /** Rows that the statement inserted, updated, or deleted, not counting trigger changes. */
  readonly changes: number;
};

/**
 * The only database contract outside `src/db/`.
 *
 * Writes that must be atomic go through `batch`, because D1 has no interactive transactions.
 */
export type Database = {
  readonly all: <Row>(statement: Statement, decode: RowDecoder<Row>) => Promise<Row[]>;
  readonly first: <Row>(statement: Statement, decode: RowDecoder<Row>) => Promise<Row | undefined>;
  readonly run: (statement: Statement) => Promise<RunResult>;
  /** Runs every statement in order inside one transaction, or none of them when one fails. */
  readonly batch: (statements: readonly Statement[]) => Promise<RunResult[]>;
  readonly close: () => Promise<void>;
};

/** Builds a statement with positional `?` parameters. */
export const sql = (text: string, params: readonly SqlValue[] = []): Statement => ({
  text,
  params,
});
