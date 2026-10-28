import { type Statement, sql } from "../db/database";

/** Conditions that narrow a search. Every condition must hold. */
export type PaperFilter = {
  /** Earliest publication date as `YYYY-MM-DD`. */
  readonly since: string | null;
  /** Only papers in the library. */
  readonly saved: boolean;
  /** Only papers with this tag. */
  readonly tag: string | null;
  /** Only papers that were ingested after this ISO timestamp. */
  readonly ingestedAfter: string | null;
  /** Only papers with this Papers with Code task slug. */
  readonly task: string | null;
  /** Only papers with this Papers with Code method slug. */
  readonly method: string | null;
};

export const noFilter: PaperFilter = {
  since: null,
  saved: false,
  tag: null,
  ingestedAfter: null,
  task: null,
  method: null,
};

const hasConcept = (kind: string) => `(? IS NULL OR EXISTS (
      SELECT 1 FROM paper_concepts pc JOIN concepts c ON c.id = pc.concept_id
      WHERE pc.paper_id = p.id AND c.kind = '${kind}' AND c.slug = ?))`;

/** An SQL condition with its parameters, for a query that gives `papers` the alias `p`. */
export const filterCondition = (filter: PaperFilter): Statement =>
  sql(
    `(? IS NULL OR p.published_at >= ?)
    AND (? = 0 OR EXISTS (SELECT 1 FROM library lib WHERE lib.paper_id = p.id AND lib.saved_at IS NOT NULL))
    AND (? IS NULL OR EXISTS (
      SELECT 1 FROM paper_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.paper_id = p.id AND t.name = ?))
    AND (? IS NULL OR p.ingested_at > ?)
    AND ${hasConcept("task")}
    AND ${hasConcept("method")}`,
    [
      filter.since,
      filter.since,
      filter.saved ? 1 : 0,
      filter.tag,
      filter.tag,
      filter.ingestedAfter,
      filter.ingestedAfter,
      filter.task,
      filter.task,
      filter.method,
      filter.method,
    ],
  );
