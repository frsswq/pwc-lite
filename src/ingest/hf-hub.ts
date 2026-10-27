import { z } from "zod";

import { syncHubLinks } from "../catalog/write";
import { type Database, type SqlRow, sql } from "../db/database";
import { type ArxivId, parseArxivId } from "../domain/arxiv-id";
import { arxivIdMonth } from "../domain/arxiv-month";
import { addDays } from "../domain/dates";
import { fetchPaperRepos, fetchTrendingArxivIds } from "../sources/hf-hub";
import type { HttpClient } from "../sources/http";
import type { RateLimiter } from "../sources/rate-limit";
import { storeArxivPapers } from "./arxiv";

/** Spacing for Hub requests, well inside the anonymous rate limit. */
export const hubIntervalMs = 250;

export type HubIngestOptions = {
  readonly now: string;
  /** Current UTC date as `YYYY-MM-DD`. */
  readonly today: string;
  readonly token: string | null;
  /** Add recent papers that trending models and datasets cite. */
  readonly discover: boolean;
  /** Discovery adds only papers submitted inside this window. */
  readonly retentionDays: number;
  /** Most papers whose links one run refreshes. */
  readonly refreshLimit: number;
  /** Links older than this many days are due for a refresh. */
  readonly staleDays: number;
};

export type HubIngestResult = {
  readonly discovered: readonly ArxivId[];
  readonly refreshed: number;
  readonly links: number;
};

const idRow = z.object({ id: z.string() });

const decodeId = (row: SqlRow): ArxivId => {
  const parsed = parseArxivId(idRow.parse(row).id);

  if (parsed === null) {
    throw new Error(`Expected an arXiv ID, got ${String(row.id)}`);
  }

  return parsed.id;
};

const notInCatalog = async (db: Database, ids: readonly ArxivId[]): Promise<ArxivId[]> =>
  db.all(
    sql("SELECT value AS id FROM json_each(?) WHERE value NOT IN (SELECT id FROM papers)", [
      JSON.stringify(ids),
    ]),
    decodeId,
  );

const dueForRefresh = async (db: Database, cutoff: string, limit: number): Promise<ArxivId[]> =>
  db.all(
    sql(
      `SELECT id FROM papers WHERE hub_fetched_at IS NULL OR hub_fetched_at < ?
       ORDER BY hub_fetched_at IS NOT NULL, coalesce(published_at, ingested_at) DESC, id LIMIT ?`,
      [cutoff, limit],
    ),
    decodeId,
  );

/**
 * Adds recent papers that trending Hub repositories cite, then refreshes the Hub links of papers that are due.
 *
 * Papers that were never fetched come first, newest first.
 */
export const ingestHub = async (
  db: Database,
  client: HttpClient,
  limiters: { readonly hub: RateLimiter; readonly arxiv: RateLimiter },
  options: HubIngestOptions,
): Promise<HubIngestResult> => {
  let discovered: readonly ArxivId[] = [];

  if (options.discover) {
    const earliestMonth = addDays(options.today, -options.retentionDays).slice(0, 7);
    const cited = await fetchTrendingArxivIds(client, options.token);
    const recent = cited.filter((id) => (arxivIdMonth(id) ?? "") >= earliestMonth);
    const unknown = await notInCatalog(db, recent);

    if (unknown.length > 0) {
      discovered = (
        await storeArxivPapers(db, client, limiters.arxiv, unknown, "hf_hub", options.now)
      ).stored;
    }
  }

  const due = await dueForRefresh(
    db,
    addDays(options.today, -options.staleDays),
    options.refreshLimit,
  );

  let links = 0;

  for (const id of due) {
    await limiters.hub.wait();

    const found = await fetchPaperRepos(client, id, options.token);

    await db.batch(syncHubLinks(id, found, options.now));
    links += found.length;
  }

  return { discovered, refreshed: due.length, links };
};
