import { z } from "zod";

import type { SqlRow } from "../db/database";
import { type ArxivId, parseArxivId } from "../domain/arxiv-id";
import {
  type Link,
  type Paper,
  type Signal,
  addedViaValues,
  linkKinds,
  signalSources,
} from "../domain/paper";

const arxivIdText = z.string().transform((text, context): ArxivId => {
  const parsed = parseArxivId(text);

  if (parsed === null || parsed.id !== text) {
    context.addIssue({ code: "custom", message: `"${text}" is not a canonical arXiv ID` });

    return z.NEVER;
  }

  return parsed.id;
});

const jsonStrings = z
  .string()
  .transform((text) => JSON.parse(text))
  .pipe(z.array(z.string()));

/** Every `papers` column that `decodePaper` reads, for a query that gives `papers` the alias `p`. */
export const paperColumns = `p.id, p.version, p.title, p.abstract, p.authors, p.published_at, p.updated_at,
  p.primary_category, p.categories, p.doi, p.added_via, p.ingested_at, p.arxiv_fetched_at`;

const paperRow = z.object({
  id: arxivIdText,
  version: z.number().int().nullable(),
  title: z.string(),
  abstract: z.string(),
  authors: jsonStrings,
  published_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  primary_category: z.string().nullable(),
  categories: jsonStrings,
  doi: z.string().nullable(),
  added_via: z.enum(addedViaValues),
  ingested_at: z.string(),
  arxiv_fetched_at: z.string().nullable(),
});

export const decodePaper = (row: SqlRow): Paper => {
  const value = paperRow.parse(row);

  return {
    id: value.id,
    version: value.version,
    title: value.title,
    abstract: value.abstract,
    authors: value.authors,
    publishedAt: value.published_at,
    updatedAt: value.updated_at,
    primaryCategory: value.primary_category,
    categories: value.categories,
    doi: value.doi,
    addedVia: value.added_via,
    ingestedAt: value.ingested_at,
    arxivFetchedAt: value.arxiv_fetched_at,
  };
};

const linkRow = z.object({
  paper_id: arxivIdText,
  kind: z.enum(linkKinds),
  external_id: z.string(),
  url: z.string(),
  popularity: z.number().int().nullable(),
  last_activity_at: z.string().nullable(),
});

export const decodeLink = (row: SqlRow): Link => {
  const value = linkRow.parse(row);

  return {
    paperId: value.paper_id,
    kind: value.kind,
    externalId: value.external_id,
    url: value.url,
    popularity: value.popularity,
    lastActivityAt: value.last_activity_at,
  };
};

const signalRow = z.object({
  paper_id: arxivIdText,
  source: z.enum(signalSources),
  observed_on: z.string(),
  score: z.number().int(),
});

export const decodeSignal = (row: SqlRow): Signal => {
  const value = signalRow.parse(row);

  return {
    paperId: value.paper_id,
    source: value.source,
    observedOn: value.observed_on,
    score: value.score,
  };
};
