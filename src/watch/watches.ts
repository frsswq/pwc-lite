import { z } from "zod";

import { type Database, type SqlRow, sql } from "../db/database";
import { noFilter } from "../query/filter";
import { type PaperSummary, searchPapers, toFtsQuery } from "../query/papers";

export type Watch = {
  readonly id: number;
  readonly query: string;
  readonly createdAt: string;
  /** Papers ingested after this ISO timestamp are new for the watch. */
  readonly lastSeenAt: string;
};

export type WatchResult = {
  readonly watch: Watch;
  /** New papers that match the query, best keyword match first. */
  readonly papers: readonly PaperSummary[];
};

const watchRow = z.object({
  id: z.number().int(),
  query: z.string(),
  created_at: z.string(),
  last_seen_at: z.string(),
});

const decodeWatch = (row: SqlRow): Watch => {
  const value = watchRow.parse(row);

  return {
    id: value.id,
    query: value.query,
    createdAt: value.created_at,
    lastSeenAt: value.last_seen_at,
  };
};

const watchColumns = "id, query, created_at, last_seen_at";

/** A watch query must have at least one word, because it matches papers by keywords. */
export const isWatchQuery = (query: string): boolean => toFtsQuery(query) !== null;

/** Adds a watch, or returns null when the same query is already watched. */
export const addWatch = async (
  db: Database,
  query: string,
  options: { readonly now: string; readonly lastSeenAt: string },
): Promise<Watch | null> =>
  (await db.first(
    sql(
      `INSERT INTO watches (query, created_at, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT (query) DO NOTHING RETURNING ${watchColumns}`,
      [query, options.now, options.lastSeenAt],
    ),
    decodeWatch,
  )) ?? null;

export const listWatches = async (db: Database): Promise<Watch[]> =>
  db.all(sql(`SELECT ${watchColumns} FROM watches ORDER BY id`), decodeWatch);

/** Removes a watch and returns whether it existed. */
export const removeWatch = async (db: Database, id: number): Promise<boolean> =>
  (await db.run(sql("DELETE FROM watches WHERE id = ?", [id]))).changes > 0;

const latestRow = z.object({ latest: z.string().nullable() });

/**
 * Finds new papers for every watch.
 *
 * Unless `dryRun` is set, each watch then moves its `last_seen_at` to the newest `ingested_at` in the catalog.
 * The newest `ingested_at` is read before the search, so that a paper that an ingest adds during the run is new on the next run.
 */
export const runWatches = async (
  db: Database,
  options: { readonly limit: number; readonly dryRun: boolean },
): Promise<WatchResult[]> => {
  const latest = await db.first(
    sql("SELECT max(ingested_at) AS latest FROM papers"),
    (row) => latestRow.parse(row).latest,
  );

  const watches = await listWatches(db);
  const results: WatchResult[] = [];

  for (const watch of watches) {
    const papers = await searchPapers(db, {
      query: watch.query,
      limit: options.limit,
      filter: { ...noFilter, ingestedAfter: watch.lastSeenAt },
    });

    results.push({ watch, papers });
  }

  if (!options.dryRun && latest !== undefined && latest !== null) {
    await db.run(
      sql("UPDATE watches SET last_seen_at = ? WHERE last_seen_at < ? AND id <= ?", [
        latest,
        latest,
        watches.at(-1)?.id ?? 0,
      ]),
    );
  }

  return results;
};
