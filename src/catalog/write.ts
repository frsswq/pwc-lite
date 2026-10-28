import { type Statement, sql } from "../db/database";
import type { ArxivId } from "../domain/arxiv-id";
import {
  type AddedVia,
  type Link,
  type PaperRecord,
  type Signal,
  hubLinkKinds,
} from "../domain/paper";

const paperColumns = [
  "version",
  "title",
  "abstract",
  "authors",
  "published_at",
  "updated_at",
  "primary_category",
  "categories",
  "doi",
] as const;

const assignments = paperColumns.map((column) => `${column} = excluded.${column}`).join(", ");

const differences = paperColumns
  .map((column) => `papers.${column} IS NOT excluded.${column}`)
  .join(" OR ");

const paperValues = (paper: PaperRecord) => [
  paper.id,
  paper.version,
  paper.title,
  paper.abstract,
  JSON.stringify(paper.authors),
  paper.publishedAt,
  paper.updatedAt,
  paper.primaryCategory,
  JSON.stringify(paper.categories),
  paper.doi,
];

const insertPaper = `INSERT INTO papers (id, ${paperColumns.join(", ")}, added_via, ingested_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Adds a paper from a listing source, or refreshes its metadata.
 *
 * The refresh changes nothing after arXiv metadata arrives, because arXiv is the authority for metadata.
 * The statement writes nothing when the values are the same, which keeps repeated ingests free of writes.
 */
export const writeListedPaper = (paper: PaperRecord, addedVia: AddedVia, now: string): Statement =>
  sql(
    `${insertPaper}
     ON CONFLICT (id) DO UPDATE SET ${assignments}
     WHERE papers.arxiv_fetched_at IS NULL AND (${differences})`,
    [...paperValues(paper), addedVia, now],
  );

/** Adds a paper with arXiv metadata, or replaces its metadata with the arXiv values. */
export const writeArxivPaper = (paper: PaperRecord, addedVia: AddedVia, now: string): Statement =>
  sql(
    `INSERT INTO papers (id, ${paperColumns.join(", ")}, added_via, ingested_at, arxiv_fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET ${assignments}, arxiv_fetched_at = excluded.arxiv_fetched_at`,
    [...paperValues(paper), addedVia, now, now],
  );

/**
 * Adds or refreshes a link that a listing source reports.
 *
 * Popularity from a listing does not replace a value that a direct fetch of the link target stored.
 */
export const writeListedLink = (link: Link): Statement =>
  sql(
    `INSERT INTO links (paper_id, kind, external_id, url, popularity, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (paper_id, kind, external_id) DO UPDATE SET
       url = excluded.url,
       popularity = excluded.popularity,
       last_activity_at = excluded.last_activity_at
     WHERE links.fetched_at IS NULL AND (
       links.url IS NOT excluded.url
       OR links.popularity IS NOT excluded.popularity
       OR links.last_activity_at IS NOT excluded.last_activity_at
     )`,
    [link.paperId, link.kind, link.externalId, link.url, link.popularity, link.lastActivityAt],
  );

export const writeSignal = (signal: Signal): Statement =>
  sql(
    `INSERT INTO signals (paper_id, source, observed_on, score) VALUES (?, ?, ?, ?)
     ON CONFLICT (paper_id, source, observed_on) DO UPDATE SET score = excluded.score
     WHERE signals.score IS NOT excluded.score`,
    [signal.paperId, signal.source, signal.observedOn, signal.score],
  );

/** Moves a cursor forward. A cursor never moves back, so a backfill does not repeat later work. */
export const advanceCursor = (source: string, cursor: string, now: string): Statement =>
  sql(
    `INSERT INTO ingest_cursors (source, cursor, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (source) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
     WHERE excluded.cursor > ingest_cursors.cursor`,
    [source, cursor, now],
  );

/**
 * Replaces the Hugging Face Hub links of a paper with the links from a fetch, and records the fetch time.
 *
 * Links of other kinds do not change.
 */
export const syncHubLinks = (
  paperId: ArxivId,
  links: readonly Link[],
  now: string,
): Statement[] => [
  sql(
    `DELETE FROM links WHERE paper_id = ? AND kind IN (SELECT value FROM json_each(?))
     AND kind || ' ' || external_id NOT IN (SELECT value FROM json_each(?))`,
    [
      paperId,
      JSON.stringify(hubLinkKinds),
      JSON.stringify(links.map((link) => `${link.kind} ${link.externalId}`)),
    ],
  ),
  ...links.map((link) =>
    sql(
      `INSERT INTO links (paper_id, kind, external_id, url, popularity, last_activity_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (paper_id, kind, external_id) DO UPDATE SET
         url = excluded.url,
         popularity = excluded.popularity,
         last_activity_at = excluded.last_activity_at,
         fetched_at = excluded.fetched_at`,
      [
        link.paperId,
        link.kind,
        link.externalId,
        link.url,
        link.popularity,
        link.lastActivityAt,
        now,
      ],
    ),
  ),
  sql("UPDATE papers SET hub_fetched_at = ? WHERE id = ?", [now, paperId]),
];

/** Stores GitHub stats on every link to the repository, so each repository needs one request. */
export const writeGithubStats = (
  externalId: string,
  stats: { readonly url: string; readonly stars: number; readonly pushedAt: string | null },
  now: string,
): Statement =>
  sql(
    `UPDATE links SET url = ?, popularity = ?, last_activity_at = ?, fetched_at = ?
     WHERE kind = 'github' AND external_id = ?`,
    [stats.url, stats.stars, stats.pushedAt, now, externalId],
  );

/** Records a fetch of a repository that is gone, so the next run does not retry it at once. */
export const markGithubChecked = (externalId: string, now: string): Statement =>
  sql("UPDATE links SET fetched_at = ? WHERE kind = 'github' AND external_id = ?", [
    now,
    externalId,
  ]);
