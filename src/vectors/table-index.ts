import { z } from "zod";

import { type Database, type SqlRow, sql } from "../db/database";
import {
  type VectorEntry,
  type VectorIndex,
  type VectorMatch,
  dot,
  normalize,
} from "./vector-index";

const vectorRow = z.object({ id: z.string(), vector: z.instanceof(Uint8Array) });

const toBytes = (vector: Float32Array): Uint8Array =>
  new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);

const decodeVector = (row: SqlRow): VectorEntry => {
  const value = vectorRow.parse(row);

  // A copy gives the float view an aligned buffer of its own.
  return { id: value.id, vector: new Float32Array(value.vector.slice().buffer) };
};

/**
 * A VectorIndex in the `vectors` table of the catalog.
 *
 * A query reads every vector of the model and compares each one.
 * This is fast enough for a personal catalog of some ten thousand papers.
 */
export const createTableVectorIndex = (db: Database, model: string): VectorIndex => ({
  model,
  upsert: async (entries) => {
    await db.batch(
      entries.map(({ id, vector }) =>
        sql(
          `INSERT INTO vectors (id, model, vector) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET model = excluded.model, vector = excluded.vector`,
          [id, model, toBytes(normalize(vector))],
        ),
      ),
    );
  },
  delete: async (ids) => {
    await db.run(
      sql("DELETE FROM vectors WHERE id IN (SELECT value FROM json_each(?))", [
        JSON.stringify(ids),
      ]),
    );
  },
  query: async (vector, limit) => {
    const target = normalize(vector);

    const rows = await db.all(
      sql("SELECT id, vector FROM vectors WHERE model = ?", [model]),
      decodeVector,
    );

    const matches: VectorMatch[] = rows.map((row) => ({
      id: row.id,
      score: dot(row.vector, target),
    }));

    return matches
      .toSorted((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, limit);
  },
});
