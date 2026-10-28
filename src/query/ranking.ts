import type { Database } from "../db/database";
import type { Embedder } from "../embed/embedder";
import type { VectorIndex } from "../vectors/vector-index";
import type { PaperFilter } from "./filter";
import { type PaperSummary, getSummaries, searchPapers } from "./papers";

export const searchModes = ["keyword", "semantic", "hybrid"] as const;

export type SearchMode = (typeof searchModes)[number];

/**
 * Every ranking weight in one place.
 *
 * A list contributes `weight / (k + rank)` by reciprocal rank fusion, where rank 1 is the best.
 * Each boost is `weight * x`, where x goes from 0 to 1.
 * The boosts are small, so that they reorder results of similar relevance but do not override relevance.
 */
export const rankingWeights = {
  /** Results that each list gives to the fusion. */
  candidates: 100,
  rrfK: 60,
  keyword: 1,
  semantic: 1,
  /** x halves for each `halfLifeDays` of age. */
  recency: { weight: 0.004, halfLifeDays: 90 },
  /** x is `links / (links + half)`. */
  links: { weight: 0.002, half: 3 },
  /** x is `p / (p + half)`, where p is the Daily Papers upvotes plus the GitHub stars. */
  popularity: { weight: 0.004, half: 200 },
} as const;

export type RankingWeights = typeof rankingWeights;

export type ScoreParts = {
  /** Position in the keyword list, from 1, or null when the paper is not in it. */
  readonly keywordRank: number | null;
  readonly semanticRank: number | null;
  readonly keyword: number;
  readonly semantic: number;
  readonly recency: number;
  readonly links: number;
  readonly popularity: number;
};

export type RankedHit = PaperSummary & {
  /** The sum of the score parts. */
  readonly score: number;
  readonly parts: ScoreParts;
};

const dayMs = 24 * 60 * 60 * 1000;

const saturate = (value: number, half: number) => value / (value + half);

const fusion = (rank: number | null, weight: number, weights: RankingWeights) =>
  rank === null ? 0 : weight / (weights.rrfK + rank);

/**
 * Merges ranked lists into one list with reciprocal rank fusion and boosts.
 *
 * A paper that is in only one list gets a score from that list alone.
 * Ties go to the lower arXiv ID, so that the order is stable.
 */
export const fuseRankings = (
  keyword: readonly PaperSummary[],
  semantic: readonly PaperSummary[],
  options: { readonly now: Date; readonly limit: number; readonly weights?: RankingWeights },
): RankedHit[] => {
  const weights = options.weights ?? rankingWeights;
  const papers = new Map<string, PaperSummary>();
  const keywordRanks = new Map<string, number>();
  const semanticRanks = new Map<string, number>();

  for (const [position, summary] of keyword.entries()) {
    papers.set(summary.paper.id, summary);
    keywordRanks.set(summary.paper.id, position + 1);
  }

  for (const [position, summary] of semantic.entries()) {
    papers.set(summary.paper.id, summary);
    semanticRanks.set(summary.paper.id, position + 1);
  }

  const hits = [...papers.values()].map((summary): RankedHit => {
    const { paper } = summary;
    const keywordRank = keywordRanks.get(paper.id) ?? null;
    const semanticRank = semanticRanks.get(paper.id) ?? null;
    const dated = Date.parse(paper.publishedAt ?? paper.ingestedAt);
    const ageDays = Math.max(0, (options.now.getTime() - dated) / dayMs);
    const popularity = (summary.upvotes ?? 0) + (summary.githubStars ?? 0);

    const parts: ScoreParts = {
      keywordRank,
      semanticRank,
      keyword: fusion(keywordRank, weights.keyword, weights),
      semantic: fusion(semanticRank, weights.semantic, weights),
      recency: weights.recency.weight * 0.5 ** (ageDays / weights.recency.halfLifeDays),
      links: weights.links.weight * saturate(summary.linkCount, weights.links.half),
      popularity: weights.popularity.weight * saturate(popularity, weights.popularity.half),
    };

    return {
      paper,
      upvotes: summary.upvotes,
      githubStars: summary.githubStars,
      linkCount: summary.linkCount,
      score: parts.keyword + parts.semantic + parts.recency + parts.links + parts.popularity,
      parts,
    };
  });

  return hits
    .toSorted(
      (left, right) => right.score - left.score || left.paper.id.localeCompare(right.paper.id),
    )
    .slice(0, options.limit);
};

export type RankedSearchOptions = {
  readonly query: string;
  readonly mode: SearchMode;
  readonly limit: number;
  readonly filter: PaperFilter;
  readonly now: Date;
};

export type SemanticSearch = {
  readonly embedder: Embedder;
  readonly index: VectorIndex;
};

/** Papers most similar to the query, most similar first. */
const semanticList = async (
  db: Database,
  semantic: SemanticSearch,
  query: string,
  filter: PaperFilter,
): Promise<PaperSummary[]> => {
  if (query.trim() === "") {
    return [];
  }

  const matches = await semantic.index.query(
    await semantic.embedder.embedQuery(query),
    rankingWeights.candidates,
  );

  const summaries = new Map<string, PaperSummary>(
    (
      await getSummaries(
        db,
        matches.map(({ id }) => id),
        filter,
      )
    ).map((summary) => [summary.paper.id, summary]),
  );

  return matches.flatMap(({ id }) => summaries.get(id) ?? []);
};

/** Searches with keywords, vectors, or both, and ranks the results with `fuseRankings`. */
export const rankedSearch = async (
  db: Database,
  semantic: SemanticSearch,
  options: RankedSearchOptions,
): Promise<RankedHit[]> => {
  const keyword =
    options.mode === "semantic"
      ? []
      : await searchPapers(db, {
          query: options.query,
          limit: rankingWeights.candidates,
          filter: options.filter,
        });

  const similar =
    options.mode === "keyword"
      ? []
      : await semanticList(db, semantic, options.query, options.filter);

  return fuseRankings(keyword, similar, { now: options.now, limit: options.limit });
};
