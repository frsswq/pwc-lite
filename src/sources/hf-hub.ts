import { z } from "zod";

import { type ArxivId, parseArxivId } from "../domain/arxiv-id";
import type { HubLinkKind, Link } from "../domain/paper";
import { type HttpClient, bearer, getJson } from "./http";

const source = "Hugging Face Hub";
const api = "https://huggingface.co/api";

/** Links kept per kind. Popular papers have thousands of artifacts, and the API returns at most 100 per kind. */
export const maxLinksPerKind = 25;

const repoSchema = z.object({
  id: z.string().min(1),
  likes: z.number().int().nonnegative().default(0),
  lastModified: z.iso.datetime({ offset: true }).optional(),
  private: z.boolean().default(false),
});

const reposSchema = z.object({
  models: z.array(repoSchema).default([]),
  datasets: z.array(repoSchema).default([]),
  spaces: z.array(repoSchema).default([]),
});

const urlPrefix = {
  hf_model: "https://huggingface.co/",
  hf_dataset: "https://huggingface.co/datasets/",
  hf_space: "https://huggingface.co/spaces/",
} as const;

const toLinks = (
  paperId: ArxivId,
  kind: HubLinkKind,
  repos: readonly z.infer<typeof repoSchema>[],
) =>
  repos
    .filter((repo) => !repo.private)
    .toSorted((a, b) => b.likes - a.likes || a.id.localeCompare(b.id))
    .slice(0, maxLinksPerKind)
    .map((repo): Link => ({
      paperId,
      kind,
      externalId: repo.id,
      url: `${urlPrefix[kind]}${repo.id}`,
      popularity: repo.likes,
      lastActivityAt:
        repo.lastModified === undefined ? null : new Date(repo.lastModified).toISOString(),
    }));

/** Fetches the models, datasets, and Spaces that cite a paper, most liked first. */
export const fetchPaperRepos = async (
  client: HttpClient,
  id: ArxivId,
  token: string | null,
): Promise<Link[]> => {
  const repos = await getJson(
    client,
    { source, url: `${api}/arxiv/${encodeURIComponent(id)}/repos`, headers: bearer(token) },
    reposSchema,
  );

  return [
    ...toLinks(id, "hf_model", repos.models),
    ...toLinks(id, "hf_dataset", repos.datasets),
    ...toLinks(id, "hf_space", repos.spaces),
  ];
};

const taggedSchema = z.array(z.object({ tags: z.array(z.string()).default([]) }));

const trendingLimit = 100;

/** Lists arXiv IDs that trending models and datasets cite, in trending order without duplicates. */
export const fetchTrendingArxivIds = async (
  client: HttpClient,
  token: string | null,
): Promise<ArxivId[]> => {
  const ids = new Set<ArxivId>();

  for (const kind of ["models", "datasets"]) {
    const repos = await getJson(
      client,
      {
        source,
        url: `${api}/${kind}?sort=trendingScore&limit=${trendingLimit}`,
        headers: bearer(token),
      },
      taggedSchema,
    );

    for (const tag of repos.flatMap((repo) => repo.tags)) {
      const parsed = tag.startsWith("arxiv:") ? parseArxivId(tag) : null;

      if (parsed !== null) {
        ids.add(parsed.id);
      }
    }
  }

  return [...ids];
};
