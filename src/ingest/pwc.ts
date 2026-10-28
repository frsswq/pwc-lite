import { z } from "zod";

import { recordConceptFetch, syncPaperConcepts } from "../catalog/concepts";
import { type Database, type SqlRow, sql } from "../db/database";
import { type ArxivId, parseArxivId } from "../domain/arxiv-id";
import type { HttpClient } from "../sources/http";
import { fetchPaperConcepts } from "../sources/pwc";
import type { RateLimiter } from "../sources/rate-limit";

export type ConceptIngestOptions = {
  /** Current time as an ISO timestamp. */
  readonly now: string;
  /** Most papers to look up in this run. */
  readonly limit: number;
  /** Days after which a found paper is looked up again. */
  readonly staleDays: number;
  /** Days after which a paper that was not found is looked up again. New papers appear after some days. */
  readonly retryDays: number;
};

export type ConceptIngestResult = {
  readonly found: number;
  readonly notFound: number;
  readonly concepts: number;
};

const dayMs = 24 * 60 * 60 * 1000;

const idRow = z.object({ id: z.string() });

const decodeId = (row: SqlRow): ArxivId => {
  const parsed = parseArxivId(idRow.parse(row).id);

  if (parsed === null) {
    throw new Error(`papers.id is not an arXiv ID: ${String(row.id)}`);
  }

  return parsed.id;
};

const before = (now: string, days: number) =>
  new Date(Date.parse(now) - days * dayMs).toISOString();

/** Papers that were never looked up come first, then the newest papers. */
export const dueConceptPapers = async (
  db: Database,
  options: ConceptIngestOptions,
): Promise<ArxivId[]> =>
  db.all(
    sql(
      `SELECT p.id FROM papers p LEFT JOIN concept_fetches f ON f.paper_id = p.id
       WHERE f.paper_id IS NULL
          OR (f.found = 1 AND f.fetched_at < ?)
          OR (f.found = 0 AND f.fetched_at < ?)
       ORDER BY f.paper_id IS NULL DESC, coalesce(p.published_at, p.ingested_at) DESC, p.id
       LIMIT ?`,
      [
        before(options.now, options.staleDays),
        before(options.now, options.retryDays),
        options.limit,
      ],
    ),
    decodeId,
  );

/** Looks up the tasks and methods of due papers, one request at a time. */
export const ingestConcepts = async (
  db: Database,
  client: HttpClient,
  limiter: RateLimiter,
  options: ConceptIngestOptions,
): Promise<ConceptIngestResult> => {
  let found = 0;
  let notFound = 0;
  let concepts = 0;

  for (const id of await dueConceptPapers(db, options)) {
    await limiter.wait();

    const result = await fetchPaperConcepts(client, id);

    if (result.status === "found") {
      await db.batch(syncPaperConcepts(id, result.concepts, options.now));
      found += 1;
      concepts += result.concepts.length;
    } else {
      await db.run(recordConceptFetch(id, false, options.now));
      notFound += 1;
    }
  }

  return { found, notFound, concepts };
};
