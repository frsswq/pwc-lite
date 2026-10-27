import { z } from "zod";

import { writeArxivPaper } from "../catalog/write";
import { type Database, type SqlRow, sql } from "../db/database";
import { type ArxivId, parseArxivId } from "../domain/arxiv-id";
import type { AddedVia } from "../domain/paper";
import { fetchArxivPapers } from "../sources/arxiv";
import type { HttpClient } from "../sources/http";
import type { RateLimiter } from "../sources/rate-limit";

export type ArxivStoreResult = {
  readonly stored: readonly ArxivId[];
  readonly missing: readonly ArxivId[];
};

const idRow = z.object({ id: z.string() });

const decodeId = (row: SqlRow): ArxivId => {
  const parsed = parseArxivId(idRow.parse(row).id);

  if (parsed === null) {
    throw new Error(`papers.id is not an arXiv ID: ${String(row.id)}`);
  }

  return parsed.id;
};

/** Lists papers that have no arXiv metadata yet, newest first. */
export const pendingArxivIds = async (db: Database, limit: number): Promise<ArxivId[]> =>
  db.all(
    sql(
      "SELECT id FROM papers WHERE arxiv_fetched_at IS NULL ORDER BY ingested_at DESC, id LIMIT ?",
      [limit],
    ),
    decodeId,
  );

/**
 * Fetches arXiv metadata and stores it.
 *
 * `addedVia` applies only to papers that are not in the catalog yet.
 */
export const storeArxivPapers = async (
  db: Database,
  client: HttpClient,
  limiter: RateLimiter,
  ids: readonly ArxivId[],
  addedVia: AddedVia,
  now: string,
): Promise<ArxivStoreResult> => {
  const { papers, missingIds } = await fetchArxivPapers(client, limiter, ids);

  if (papers.length > 0) {
    await db.batch(papers.map((paper) => writeArxivPaper(paper, addedVia, now)));
  }

  return { stored: papers.map(({ id }) => id), missing: missingIds };
};
