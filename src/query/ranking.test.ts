import { beforeEach, describe, expect, test } from "bun:test";

import { writeListedPaper, writeSignal } from "../catalog/write";
import type { Database } from "../db/database";
import { embedPapers } from "../ingest/embed";
import { openTestCatalog, paperRecord } from "../testing/catalog";
import { keywordEmbedder } from "../testing/embedder";
import { createTableVectorIndex } from "../vectors/table-index";
import type { PaperSummary } from "./papers";
import {
  type RankedHit,
  type ScoreParts,
  fuseRankings,
  rankedSearch,
  rankingWeights,
} from "./ranking";

/** The score parts of a hit, or a failed test when the hit is missing. */
const partsOf = (hit: RankedHit | undefined): ScoreParts => {
  if (hit === undefined) {
    throw new Error("Expected a hit");
  }

  return hit.parts;
};

const now = new Date("2026-10-24T00:00:00.000Z");

const summary = (
  id: string,
  publishedAt: string,
  counts: { upvotes?: number; stars?: number; links?: number } = {},
): PaperSummary => ({
  paper: {
    ...paperRecord(id, `Paper ${id}`),
    publishedAt,
    addedVia: "hf_daily",
    ingestedAt: publishedAt,
    arxivFetchedAt: null,
  },
  upvotes: counts.upvotes ?? null,
  githubStars: counts.stars ?? null,
  linkCount: counts.links ?? 0,
});

const ids = (hits: readonly RankedHit[]): string[] => hits.map(({ paper }) => `${paper.id}`);

describe("fuseRankings", () => {
  const a = summary("2610.00001", "2026-10-24T00:00:00.000Z");
  const b = summary("2610.00002", "2026-10-24T00:00:00.000Z");
  const c = summary("2610.00003", "2026-10-24T00:00:00.000Z");
  const d = summary("2610.00004", "2026-10-24T00:00:00.000Z");

  test("gives a fixed ranking for fixed inputs", () => {
    const hits = fuseRankings([a, b, c], [c, a, d], { now, limit: 10 });

    // a: 1/61 + 1/62, c: 1/63 + 1/61, b: 1/62, d: 1/63.
    expect(ids(hits)).toEqual(["2610.00001", "2610.00003", "2610.00002", "2610.00004"]);
    expect(partsOf(hits[0])).toMatchObject({ keywordRank: 1, semanticRank: 2 });
    expect(hits[0]?.score).toBeCloseTo(1 / 61 + 1 / 62 + rankingWeights.recency.weight, 10);
  });

  test("keeps a paper that is in only one list", () => {
    const hits = fuseRankings([a], [d], { now, limit: 10 });

    expect(ids(hits)).toEqual(["2610.00001", "2610.00004"]);
    expect(partsOf(hits[1])).toMatchObject({ keywordRank: null, semanticRank: 1, keyword: 0 });
  });

  test("breaks a tie with the lower arXiv ID", () => {
    expect(ids(fuseRankings([b], [a], { now, limit: 10 }))).toEqual(["2610.00001", "2610.00002"]);
  });

  test("lets boosts reorder papers of similar relevance", () => {
    const popular = summary("2610.00009", "2026-10-24T00:00:00.000Z", {
      upvotes: 300,
      stars: 500,
      links: 6,
    });

    const old = summary("2610.00008", "2025-10-24T00:00:00.000Z");

    expect(ids(fuseRankings([old, popular], [], { now, limit: 10 }))).toEqual([
      "2610.00009",
      "2610.00008",
    ]);
  });

  test("does not let boosts override a large relevance gap", () => {
    const popular = summary("2610.00009", "2026-10-24T00:00:00.000Z", { upvotes: 9000 });
    const list = [a, b, c, d, summary("2610.00005", "2026-10-24T00:00:00.000Z")];

    expect(ids(fuseRankings([...list, popular], [...list], { now, limit: 1 }))).toEqual([
      "2610.00001",
    ]);
  });

  test("gives a score that is the sum of its parts, in descending order", () => {
    const hits = fuseRankings(
      [a, b, summary("2610.00007", "2026-01-01T00:00:00.000Z", { stars: 40, links: 2 })],
      [d, a],
      { now, limit: 10 },
    );

    for (const { score, parts } of hits) {
      expect(score).toBeCloseTo(
        parts.keyword + parts.semantic + parts.recency + parts.links + parts.popularity,
        12,
      );
    }

    const scores = hits.map(({ score }) => score);

    expect(scores).toEqual(scores.toSorted((left, right) => right - left));
  });

  test("applies the limit after the fusion", () => {
    expect(fuseRankings([a, b], [c, d], { now, limit: 2 })).toHaveLength(2);
  });
});

describe("rankedSearch", () => {
  let db: Database;
  const embedder = keywordEmbedder(["diffusion", "denoising", "robot"]);

  beforeEach(async () => {
    db = await openTestCatalog();
    await db.batch([
      writeListedPaper(paperRecord("2610.00001", "Diffusion for video"), "hf_daily", "x"),
      writeListedPaper(
        {
          ...paperRecord("2610.00002", "Denoising generative models"),
          abstract: "Denoising denoising denoising.",
        },
        "hf_daily",
        "x",
      ),
      writeListedPaper(paperRecord("2610.00003", "Robot arms"), "hf_daily", "x"),
      writeSignal({
        paperId: paperRecord("2610.00003", "").id,
        source: "hf_daily_upvotes",
        observedOn: "2026-10-20",
        score: 3,
      }),
    ]);
    await embedPapers(db, embedder, createTableVectorIndex(db, embedder.model), {
      now: "x",
      limit: 100,
      batchSize: 10,
    });
  });

  const search = (query: string, mode: "keyword" | "semantic" | "hybrid") =>
    rankedSearch(
      db,
      { embedder, index: createTableVectorIndex(db, embedder.model) },
      { query, mode, limit: 10, since: null, now },
    );

  test("keyword mode uses only the keyword list", async () => {
    const hits = await search("diffusion", "keyword");

    expect(ids(hits)).toEqual(["2610.00001"]);
    expect(hits[0]?.parts.semanticRank).toBeNull();
  });

  test("semantic mode uses only vectors", async () => {
    const hits = await search("denoising", "semantic");

    expect(ids(hits)[0]).toBe("2610.00002");
    expect(hits.every(({ parts }) => parts.keywordRank === null)).toBeTrue();
  });

  test("hybrid mode ranks a paper in both lists first", async () => {
    const hits = await search("robot", "hybrid");

    expect(ids(hits)[0]).toBe("2610.00003");
    expect(partsOf(hits[0])).toMatchObject({ keywordRank: 1, semanticRank: 1 });
    expect(hits[0]?.upvotes).toBe(3);
  });

  test("applies since to the semantic list", async () => {
    const hits = await rankedSearch(
      db,
      { embedder, index: createTableVectorIndex(db, embedder.model) },
      { query: "robot", mode: "semantic", limit: 10, since: "2026-10-21", now },
    );

    expect(hits).toEqual([]);
  });
});
