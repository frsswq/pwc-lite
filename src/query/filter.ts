import { type Statement, sql } from "../db/database";

/** Conditions that narrow a search. Every condition must hold. */
export type PaperFilter = {
  /** Earliest publication date as `YYYY-MM-DD`. */
  readonly since: string | null;
  /** Only papers in the library. */
  readonly saved: boolean;
  /** Only papers with this tag. */
  readonly tag: string | null;
};

export const noFilter: PaperFilter = { since: null, saved: false, tag: null };

/** An SQL condition with its parameters, for a query that gives `papers` the alias `p`. */
export const filterCondition = (filter: PaperFilter): Statement =>
  sql(
    `(? IS NULL OR p.published_at >= ?)
    AND (? = 0 OR EXISTS (SELECT 1 FROM library lib WHERE lib.paper_id = p.id AND lib.saved_at IS NOT NULL))
    AND (? IS NULL OR EXISTS (
      SELECT 1 FROM paper_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.paper_id = p.id AND t.name = ?))`,
    [filter.since, filter.since, filter.saved ? 1 : 0, filter.tag, filter.tag],
  );
