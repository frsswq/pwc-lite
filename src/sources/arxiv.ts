import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

import { type ArxivId, parseArxivId } from "../domain/arxiv-id";
import type { PaperRecord } from "../domain/paper";
import { type HttpClient, checked, request } from "./http";
import type { RateLimiter } from "./rate-limit";

const source = "arXiv";
const endpoint = "https://export.arxiv.org/api/query";

/** The arXiv API terms ask for no more than one request every 3 seconds. */
export const arxivIntervalMs = 3000;
export const arxivBatchSize = 50;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["entry", "author", "category", "link"].includes(name),
});

const term = z.object({ term: z.string() });

const entrySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  published: z.iso.datetime({ offset: true }),
  updated: z.iso.datetime({ offset: true }),
  author: z.array(z.object({ name: z.string() })),
  category: z.array(term).default([]),
  primary_category: term.optional(),
  doi: z.string().optional(),
});

const feedSchema = z.object({
  feed: z.object({ entry: z.array(entrySchema).default([]) }),
});

export type ArxivBatch = {
  readonly papers: readonly PaperRecord[];
  /** Requested IDs that arXiv did not return. */
  readonly missingIds: readonly ArxivId[];
};

const collapseSpace = (text: string) => text.replaceAll(/\s+/g, " ").trim();

const toPaper = (entry: z.infer<typeof entrySchema>): PaperRecord => {
  const parsed = parseArxivId(entry.id);

  if (parsed === null) {
    throw new Error(`arXiv entry has an unexpected ID: ${entry.id}`);
  }

  return {
    id: parsed.id,
    version: parsed.version,
    title: collapseSpace(entry.title),
    abstract: collapseSpace(entry.summary),
    authors: entry.author.map(({ name }) => collapseSpace(name)),
    publishedAt: new Date(entry.published).toISOString(),
    updatedAt: new Date(entry.updated).toISOString(),
    primaryCategory: entry.primary_category?.term ?? entry.category[0]?.term ?? null,
    categories: entry.category.map(({ term: category }) => category),
    doi: entry.doi ?? null,
  };
};

/** Parses an arXiv API Atom feed into paper records. */
export const parseArxivFeed = (xml: string): PaperRecord[] =>
  checked(source, feedSchema.safeParse(parser.parse(xml))).feed.entry.map(toPaper);

const chunks = <Item>(items: readonly Item[], size: number): Item[][] => {
  const result: Item[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
};

/** Fetches metadata for arXiv IDs in batches, and waits for the rate limiter before each request. */
export const fetchArxivPapers = async (
  client: HttpClient,
  limiter: RateLimiter,
  ids: readonly ArxivId[],
): Promise<ArxivBatch> => {
  const unique = [...new Set(ids)];
  const papers: PaperRecord[] = [];

  for (const batch of chunks(unique, arxivBatchSize)) {
    await limiter.wait();

    const params = new URLSearchParams({
      id_list: batch.join(","),
      max_results: String(batch.length),
    });

    const response = await request(client, { source, url: `${endpoint}?${params}`, headers: {} });

    papers.push(...parseArxivFeed(await response.text()));
  }

  const returned = new Set<string>(papers.map(({ id }) => id));

  return { papers, missingIds: unique.filter((id) => !returned.has(id)) };
};
