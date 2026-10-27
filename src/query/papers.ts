import { z } from "zod";

import { decodeLink, decodePaper, decodeSignal, paperColumns } from "../catalog/decode";
import { type Database, type SqlRow, sql } from "../db/database";
import type { ArxivId } from "../domain/arxiv-id";
import { addDays } from "../domain/dates";
import type { Link, Paper, Signal } from "../domain/paper";

/** A paper with the values that list views and ranking use. */
export type PaperSummary = {
  readonly paper: Paper;
  /** Highest Daily Papers upvote count, or null when the paper was never listed. */
  readonly upvotes: number | null;
  readonly githubStars: number | null;
  readonly linkCount: number;
};

export type SearchHit = PaperSummary & {
  /** BM25 relevance. Higher is better. */
  readonly relevance: number;
};

export type PaperDetail = {
  readonly paper: Paper;
  readonly links: readonly Link[];
  readonly signals: readonly Signal[];
};

const summaryColumns = `${paperColumns},
  (SELECT max(score) FROM signals s WHERE s.paper_id = p.id AND s.source = 'hf_daily_upvotes') AS upvotes,
  (SELECT max(popularity) FROM links l WHERE l.paper_id = p.id AND l.kind = 'github') AS github_stars,
  (SELECT count(*) FROM links l WHERE l.paper_id = p.id) AS link_count`;

const summaryRow = z.object({
  upvotes: z.number().int().nullable(),
  github_stars: z.number().int().nullable(),
  link_count: z.number().int(),
});

const decodeSummary = (row: SqlRow): PaperSummary => {
  const value = summaryRow.parse(row);

  return {
    paper: decodePaper(row),
    upvotes: value.upvotes,
    githubStars: value.github_stars,
    linkCount: value.link_count,
  };
};

const rankRow = z.object({ rank: z.number() });

const decodeHit = (row: SqlRow): SearchHit => ({
  ...decodeSummary(row),
  relevance: -rankRow.parse(row).rank,
});

/** BM25 column weights for title, abstract, and authors. */
const columnWeights = "10.0, 1.0, 3.0";

const searchTerm = /[\p{L}\p{N}]+/gu;

/**
 * Converts free text into an FTS5 query that matches every word.
 *
 * Each word is quoted, so FTS5 operators and punctuation in user input have no special meaning.
 */
export const toFtsQuery = (text: string): string | null => {
  const terms = text.match(searchTerm) ?? [];

  return terms.length === 0 ? null : terms.map((term) => `"${term}"`).join(" ");
};

export type SearchOptions = {
  readonly query: string;
  readonly limit: number;
  /** Earliest publication date as `YYYY-MM-DD`. */
  readonly since: string | null;
};

export const searchPapers = async (db: Database, options: SearchOptions): Promise<SearchHit[]> => {
  const match = toFtsQuery(options.query);

  if (match === null) {
    return [];
  }

  return db.all(
    sql(
      `SELECT ${summaryColumns}, bm25(papers_fts, ${columnWeights}) AS rank
       FROM papers_fts JOIN papers p ON p.pk = papers_fts.rowid
       WHERE papers_fts MATCH ? AND (? IS NULL OR p.published_at >= ?)
       ORDER BY rank, p.id
       LIMIT ?`,
      [match, options.since, options.since, options.limit],
    ),
    decodeHit,
  );
};

export const getPaper = async (db: Database, id: ArxivId): Promise<PaperDetail | null> => {
  const paper = await db.first(
    sql(`SELECT ${paperColumns} FROM papers p WHERE p.id = ?`, [id]),
    decodePaper,
  );

  if (paper === undefined) {
    return null;
  }

  const links = await db.all(
    sql(
      `SELECT paper_id, kind, external_id, url, popularity, last_activity_at FROM links
       WHERE paper_id = ? ORDER BY kind, popularity DESC NULLS LAST, external_id`,
      [id],
    ),
    decodeLink,
  );

  const signals = await db.all(
    sql(
      "SELECT paper_id, source, observed_on, score FROM signals WHERE paper_id = ? ORDER BY observed_on",
      [id],
    ),
    decodeSignal,
  );

  return { paper, links, signals };
};

export type RecentOptions = {
  readonly days: number;
  /** Current UTC date as `YYYY-MM-DD`. */
  readonly today: string;
  readonly limit: number;
};

/** Lists papers published in the last `days` days, newest date first, then by upvotes. */
export const listRecentPapers = async (
  db: Database,
  options: RecentOptions,
): Promise<PaperSummary[]> =>
  db.all(
    sql(
      `SELECT ${summaryColumns} FROM papers p
       WHERE p.published_at >= ?
       ORDER BY substr(p.published_at, 1, 10) DESC, upvotes DESC NULLS LAST, p.id
       LIMIT ?`,
      [addDays(options.today, -options.days), options.limit],
    ),
    decodeSummary,
  );
