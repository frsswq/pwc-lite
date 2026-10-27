import type { ArxivId } from "./arxiv-id";

const newStyle = /^(\d{2})(\d{2})\./;

/**
 * Returns the submission month of a new style arXiv ID as `YYYY-MM`, or null for an old style ID.
 *
 * New style IDs start in April 2007, so every `YY` maps to `20YY`.
 */
export const arxivIdMonth = (id: ArxivId): string | null => {
  const match = newStyle.exec(id);

  return match?.[1] === undefined || match[2] === undefined ? null : `20${match[1]}-${match[2]}`;
};
