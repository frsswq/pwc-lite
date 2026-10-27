import { z } from "zod";

import { parseArxivId } from "../domain/arxiv-id";
import { parseGithubRepo, parseWebPage } from "../domain/link-urls";
import type { Link, PaperRecord, Signal } from "../domain/paper";
import { type HttpClient, bearer, getJson } from "./http";

const source = "Hugging Face Daily Papers";
const endpoint = "https://huggingface.co/api/daily_papers";

const entrySchema = z.object({
  paper: z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    authors: z.array(z.object({ name: z.string(), hidden: z.boolean().optional() })),
    publishedAt: z.iso.datetime({ offset: true }),
    upvotes: z.number().int().nonnegative(),
    githubRepo: z.string().nullish(),
    githubStars: z.number().int().nonnegative().nullish(),
    projectPage: z.string().nullish(),
  }),
});

const responseSchema = z.array(entrySchema);

export type DailyEntry = {
  readonly paper: PaperRecord;
  readonly links: readonly Link[];
  readonly signal: Signal;
};

export type DailyPage = {
  readonly entries: readonly DailyEntry[];
  /** HF paper IDs that are not arXiv IDs. */
  readonly skippedIds: readonly string[];
};

const collapseSpace = (text: string) => text.replaceAll(/\s+/g, " ").trim();

const toEntry = (entry: z.infer<typeof entrySchema>, date: string): DailyEntry | null => {
  const parsed = parseArxivId(entry.paper.id);

  if (parsed === null) {
    return null;
  }

  const { id } = parsed;
  const links: Link[] = [];
  const repo = entry.paper.githubRepo ? parseGithubRepo(entry.paper.githubRepo) : null;
  const page = entry.paper.projectPage ? parseWebPage(entry.paper.projectPage) : null;

  if (repo !== null) {
    links.push({
      paperId: id,
      kind: "github",
      ...repo,
      popularity: entry.paper.githubStars ?? null,
      lastActivityAt: null,
    });
  }

  if (page !== null) {
    links.push({
      paperId: id,
      kind: "project_page",
      ...page,
      popularity: null,
      lastActivityAt: null,
    });
  }

  return {
    paper: {
      id,
      version: parsed.version,
      title: collapseSpace(entry.paper.title),
      abstract: collapseSpace(entry.paper.summary),
      authors: entry.paper.authors.map(({ name }) => collapseSpace(name)),
      publishedAt: new Date(entry.paper.publishedAt).toISOString(),
      updatedAt: null,
      primaryCategory: null,
      categories: [],
      doi: null,
    },
    links,
    signal: {
      paperId: id,
      source: "hf_daily_upvotes",
      observedOn: date,
      score: entry.paper.upvotes,
    },
  };
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Fetches the Daily Papers list for one UTC date, such as `2026-10-23`. */
export const fetchDailyPapers = async (
  client: HttpClient,
  date: string,
  token: string | null,
): Promise<DailyPage> => {
  if (!isoDate.test(date)) {
    throw new RangeError(`Expected a YYYY-MM-DD date, got "${date}"`);
  }

  const response = await getJson(
    client,
    { source, url: `${endpoint}?date=${date}`, headers: bearer(token) },
    responseSchema,
  );

  const entries: DailyEntry[] = [];
  const skippedIds: string[] = [];

  for (const raw of response) {
    const entry = toEntry(raw, date);

    if (entry === null) {
      skippedIds.push(raw.paper.id);
    } else {
      entries.push(entry);
    }
  }

  return { entries, skippedIds };
};
