import { beforeEach, describe, expect, test } from "bun:test";

import { noFilter } from "./filter";
import { writeListedLink, writeListedPaper, writeSignal } from "../catalog/write";
import type { Database } from "../db/database";
import type { PaperRecord } from "../domain/paper";
import { arxivId, openTestCatalog, paperRecord } from "../testing/catalog";
import { getPaper, listRecentPapers, searchPapers, toFtsQuery } from "./papers";

const now = "2026-10-27T00:00:00.000Z";

const record = (id: string, title: string, abstract: string, publishedAt: string): PaperRecord => ({
  ...paperRecord(id, title),
  abstract,
  publishedAt,
});

const seed = async (db: Database) => {
  await db.batch([
    writeListedPaper(
      record(
        "2610.00001",
        "Retrieval augmented generation",
        "A study of language models.",
        "2026-10-20T00:00:00.000Z",
      ),
      "hf_daily",
      now,
    ),
    writeListedPaper(
      record(
        "2610.00002",
        "Sparse attention",
        "We improve retrieval for long context.",
        "2026-10-25T00:00:00.000Z",
      ),
      "hf_daily",
      now,
    ),
    writeListedPaper(
      record(
        "2610.00003",
        "Video diffusion",
        "Diffusion models for video.",
        "2026-10-25T12:00:00.000Z",
      ),
      "manual",
      now,
    ),
    writeSignal({
      paperId: arxivId("2610.00002"),
      source: "hf_daily_upvotes",
      observedOn: "2026-10-25",
      score: 3,
    }),
    writeSignal({
      paperId: arxivId("2610.00002"),
      source: "hf_daily_upvotes",
      observedOn: "2026-10-26",
      score: 9,
    }),
    writeSignal({
      paperId: arxivId("2610.00003"),
      source: "hf_daily_upvotes",
      observedOn: "2026-10-25",
      score: 20,
    }),
    writeListedLink({
      paperId: arxivId("2610.00002"),
      kind: "github",
      externalId: "a/sparse",
      url: "https://github.com/a/sparse",
      popularity: 42,
      lastActivityAt: null,
    }),
    writeListedLink({
      paperId: arxivId("2610.00002"),
      kind: "project_page",
      externalId: "sparse.example.com",
      url: "https://sparse.example.com",
      popularity: null,
      lastActivityAt: null,
    }),
  ]);
};

const ids = (items: readonly { readonly paper: { readonly id: string } }[]) =>
  items.map(({ paper }) => paper.id);

describe("toFtsQuery", () => {
  test("quotes each word and drops FTS5 syntax", () => {
    expect(toFtsQuery('retrieval AND (title:"x" OR y*) -z ^near')).toBe(
      '"retrieval" "AND" "title" "x" "OR" "y" "z" "near"',
    );
    expect(toFtsQuery("Diffusion für Vidéo 3D")).toBe('"Diffusion" "für" "Vidéo" "3D"');
    expect(toFtsQuery(' "*"() ')).toBeNull();
  });
});

describe("searchPapers", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openTestCatalog();
    await seed(db);
  });

  test("ranks a title match before an abstract-only match", async () => {
    const hits = await searchPapers(db, { query: "retrieval", limit: 10, filter: noFilter });

    expect(ids(hits)).toEqual(["2610.00001", "2610.00002"]);
    expect(hits[0]?.relevance).toBeGreaterThan(hits[1]?.relevance ?? Infinity);
  });

  test("matches word stems and requires every word", async () => {
    expect(
      ids(await searchPapers(db, { query: "retrieve contexts", limit: 10, filter: noFilter })),
    ).toEqual(["2610.00002"]);
  });

  test("returns summary values with each hit", async () => {
    const [hit] = await searchPapers(db, { query: "sparse", limit: 10, filter: noFilter });

    expect(hit).toMatchObject({ upvotes: 9, githubStars: 42, linkCount: 2 });
  });

  test("applies the since and limit filters", async () => {
    expect(
      ids(
        await searchPapers(db, {
          query: "retrieval",
          limit: 10,
          filter: { ...noFilter, since: "2026-10-21" },
        }),
      ),
    ).toEqual(["2610.00002"]);
    expect(ids(await searchPapers(db, { query: "retrieval", limit: 1, filter: noFilter }))).toEqual(
      ["2610.00001"],
    );
  });

  test("accepts input with FTS5 syntax characters", async () => {
    for (const query of ['"', "retrieval*", "a OR", "(", "NEAR(", "title:", "-", "^"]) {
      await expect(searchPapers(db, { query, limit: 10, filter: noFilter })).resolves.toBeArray();
    }
  });
});

describe("getPaper", () => {
  test("returns the paper with its links and signals", async () => {
    const db = await openTestCatalog();

    await seed(db);

    const detail = await getPaper(db, arxivId("2610.00002"));

    expect(detail?.paper).toMatchObject({
      title: "Sparse attention",
      addedVia: "hf_daily",
      ingestedAt: now,
    });
    expect(detail?.paper.authors).toEqual(["Ada Lovelace"]);
    expect(detail?.links.map(({ kind }) => kind)).toEqual(["github", "project_page"]);
    expect(detail?.signals.map(({ score }) => score)).toEqual([3, 9]);
  });

  test("returns null for an unknown ID", async () => {
    const db = await openTestCatalog();

    expect(await getPaper(db, arxivId("2610.99999"))).toBeNull();
  });
});

describe("listRecentPapers", () => {
  test("sorts by publication date, then by upvotes", async () => {
    const db = await openTestCatalog();

    await seed(db);

    expect(ids(await listRecentPapers(db, { days: 30, today: "2026-10-27", limit: 10 }))).toEqual([
      "2610.00003",
      "2610.00002",
      "2610.00001",
    ]);
    expect(ids(await listRecentPapers(db, { days: 3, today: "2026-10-27", limit: 10 }))).toEqual([
      "2610.00003",
      "2610.00002",
    ]);
  });
});
