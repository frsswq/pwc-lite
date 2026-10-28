import { type Statement, sql } from "../db/database";
import type { ArxivId } from "../domain/arxiv-id";
import type { Concept } from "../domain/paper";

const matchesEntry =
  "c.kind = json_extract(j.value, '$.kind') AND c.slug = json_extract(j.value, '$.slug')";

/**
 * Replaces the tasks and methods of a paper and records the lookup.
 *
 * Concept names update in place, so a renamed task keeps its papers.
 */
export const syncPaperConcepts = (
  paperId: ArxivId,
  concepts: readonly Concept[],
  now: string,
): Statement[] => {
  const entries = JSON.stringify(concepts);

  return [
    sql(
      `INSERT INTO concepts (kind, slug, name)
       SELECT json_extract(value, '$.kind'), json_extract(value, '$.slug'), json_extract(value, '$.name')
       FROM json_each(?) WHERE true
       ON CONFLICT (kind, slug) DO UPDATE SET name = excluded.name WHERE concepts.name IS NOT excluded.name`,
      [entries],
    ),
    sql(
      `DELETE FROM paper_concepts WHERE paper_id = ? AND concept_id NOT IN (
         SELECT c.id FROM concepts c JOIN json_each(?) j ON ${matchesEntry})`,
      [paperId, entries],
    ),
    sql(
      `INSERT INTO paper_concepts (paper_id, concept_id)
       SELECT ?, c.id FROM concepts c JOIN json_each(?) j ON ${matchesEntry} WHERE true
       ON CONFLICT (paper_id, concept_id) DO NOTHING`,
      [paperId, entries],
    ),
    recordConceptFetch(paperId, true, now),
  ];
};

/** Records a lookup. A paper that is not found keeps the concepts of an earlier lookup. */
export const recordConceptFetch = (paperId: ArxivId, found: boolean, now: string): Statement =>
  sql(
    `INSERT INTO concept_fetches (paper_id, fetched_at, found) VALUES (?, ?, ?)
     ON CONFLICT (paper_id) DO UPDATE SET fetched_at = excluded.fetched_at, found = excluded.found`,
    [paperId, now, found ? 1 : 0],
  );
