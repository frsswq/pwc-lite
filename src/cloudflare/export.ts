import { z } from "zod";

import { type Database, type SqlRow, type SqlValue, sql } from "../db/database";
import { addDays } from "../domain/dates";

export type ExportFile = {
  readonly name: string;
  readonly content: string;
};

export type ExportOptions = {
  /** The model whose vectors go to Vectorize. */
  readonly model: string;
  /** Only papers published on or after this `YYYY-MM-DD` date keep their vectors. */
  readonly vectorsSince: string;
  /** Most rows in one SQL file, so that each file fits in the D1 daily write limit. */
  readonly rowsPerFile: number;
};

/** Tables in foreign key order. `papers_fts` fills itself through triggers, and vectors go to Vectorize. */
const tables = [
  { name: "papers", order: "pk" },
  { name: "links", order: "paper_id, kind, external_id" },
  { name: "signals", order: "paper_id, source, observed_on" },
  { name: "ingest_cursors", order: "source" },
  { name: "library", order: "paper_id" },
  { name: "tags", order: "id" },
  { name: "paper_tags", order: "paper_id, tag_id" },
  { name: "watches", order: "id" },
  { name: "concepts", order: "id" },
  { name: "paper_concepts", order: "paper_id, concept_id" },
  { name: "concept_fetches", order: "paper_id" },
] as const;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Formats a value as an SQL literal.
 * Line breaks become `char(10)` and `char(13)`, so that each statement stays on one line.
 */
export const sqlLiteral = (value: SqlValue): string => {
  if (value === null) {
    return "NULL";
  }

  if (value instanceof Uint8Array) {
    return `X'${hex(value)}'`;
  }

  if (value === String(value)) {
    const quoted = `'${value.replaceAll("'", "''")}'`;

    return quoted.replaceAll("\n", "' || char(10) || '").replaceAll("\r", "' || char(13) || '");
  }

  if (!Number.isFinite(value)) {
    throw new Error(`Cannot export the number ${value}`);
  }

  return String(value);
};

const insert = (table: string, row: SqlRow): string => {
  const columns = Object.keys(row);
  const values = Object.values(row).map(sqlLiteral);

  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")}) ON CONFLICT DO NOTHING;`;
};

const keepRow = (row: SqlRow) => row;

const vectorRow = z.object({
  id: z.string(),
  vector: z.instanceof(Uint8Array),
  embedded_at: z.string(),
});

/**
 * Writes the catalog as SQL files for `wrangler d1 execute` and the vectors as NDJSON for `wrangler vectorize insert`.
 *
 * Each SQL statement inserts one row and does nothing when the row exists, so a file can run again after a failure.
 * Embedding records go only with the vectors that the export includes.
 */
export const exportForCloudflare = async (
  db: Database,
  options: ExportOptions,
): Promise<ExportFile[]> => {
  const statements: string[] = [];

  for (const table of tables) {
    const rows = await db.all(sql(`SELECT * FROM ${table.name} ORDER BY ${table.order}`), keepRow);

    statements.push(...rows.map((row) => insert(table.name, row)));
  }

  const vectors = await db.all(
    sql(
      `SELECT v.id, v.vector, e.embedded_at FROM vectors v
       JOIN embeddings e ON e.paper_id = v.id AND e.model = v.model
       JOIN papers p ON p.id = v.id
       WHERE v.model = ? AND coalesce(p.published_at, p.ingested_at) >= ?
       ORDER BY v.id`,
      [options.model, options.vectorsSince],
    ),
    (row) => vectorRow.parse(row),
  );

  statements.push(
    ...vectors.map(({ id, embedded_at }) =>
      insert("embeddings", { paper_id: id, model: options.model, embedded_at }),
    ),
  );

  const files: ExportFile[] = [];

  for (let start = 0; start < statements.length; start += options.rowsPerFile) {
    const part = String(files.length + 1).padStart(3, "0");

    files.push({
      name: `catalog-${part}.sql`,
      content: `${statements.slice(start, start + options.rowsPerFile).join("\n")}\n`,
    });
  }

  const lines = vectors.map(({ id, vector }) =>
    JSON.stringify({ id, values: Array.from(new Float32Array(vector.slice().buffer)) }),
  );

  files.push({
    name: "vectors.ndjson",
    content: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
  });

  return files;
};

/** The first date whose papers keep their vectors in the cloud, for a retention in days. */
export const vectorCutoff = (today: string, days: number): string => addDays(today, -days);
