import { z } from "zod";

import { type Database, type SqlRow, sql } from "../db/database";
import { type Embedder, paperText } from "../embed/embedder";
import type { VectorIndex } from "../vectors/vector-index";

export type EmbedOptions = {
  /** Current time as an ISO timestamp. */
  readonly now: string;
  /** Most papers to embed in this run. */
  readonly limit: number;
  readonly batchSize: number;
};

export type EmbedResult = {
  readonly embedded: number;
  /** Papers that still have no current vector after this run. */
  readonly remaining: number;
};

/** A paper needs a vector when it has none, or when its vector is from another model. */
const pending = `FROM papers p LEFT JOIN embeddings e ON e.paper_id = p.id
  WHERE e.paper_id IS NULL OR e.model IS NOT ?`;

const pendingRow = z.object({ id: z.string(), title: z.string(), abstract: z.string() });

type PendingPaper = z.infer<typeof pendingRow>;

const decodePending = (row: SqlRow): PendingPaper => pendingRow.parse(row);

const countRow = z.object({ count: z.number().int() });

export const countPendingEmbeddings = async (db: Database, model: string): Promise<number> =>
  (await db.first(
    sql(`SELECT count(*) AS count ${pending}`, [model]),
    (row) => countRow.parse(row).count,
  )) ?? 0;

/**
 * Embeds papers that have no current vector, newest first.
 *
 * Each batch writes the vectors before it records them in `embeddings`.
 * When a run stops between the two writes, the next run embeds the batch again.
 */
export const embedPapers = async (
  db: Database,
  embedder: Embedder,
  index: VectorIndex,
  options: EmbedOptions,
): Promise<EmbedResult> => {
  if (index.model !== embedder.model) {
    throw new Error(`The index is for ${index.model}, but the embedder is ${embedder.model}`);
  }

  let embedded = 0;

  while (embedded < options.limit) {
    const papers = await db.all(
      sql(
        `SELECT p.id, p.title, p.abstract ${pending}
         ORDER BY coalesce(p.published_at, p.ingested_at) DESC, p.id LIMIT ?`,
        [embedder.model, Math.min(options.batchSize, options.limit - embedded)],
      ),
      decodePending,
    );

    if (papers.length === 0) {
      break;
    }

    const vectors = await embedder.embedDocuments(papers.map(paperText));

    await index.upsert(
      papers.map((paper, position) => {
        const vector = vectors[position];

        if (vector === undefined) {
          throw new Error(`The embedder returned ${vectors.length} vectors for ${papers.length}`);
        }

        return { id: paper.id, vector };
      }),
    );

    await db.batch(
      papers.map((paper) =>
        sql(
          `INSERT INTO embeddings (paper_id, model, embedded_at) VALUES (?, ?, ?)
           ON CONFLICT (paper_id) DO UPDATE SET model = excluded.model, embedded_at = excluded.embedded_at`,
          [paper.id, embedder.model, options.now],
        ),
      ),
    );

    embedded += papers.length;
  }

  return { embedded, remaining: await countPendingEmbeddings(db, embedder.model) };
};
