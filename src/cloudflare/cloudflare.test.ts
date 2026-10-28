import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { tagPaper } from "../catalog/library";
import { syncPaperConcepts } from "../catalog/concepts";
import { writeListedLink, writeListedPaper, writeSignal } from "../catalog/write";
import { type Database, sql } from "../db/database";
import { createD1Database } from "../db/d1";
import { migrate } from "../db/migrate";
import { migrations } from "../db/migrations/index";
import { openSqliteDatabase } from "../db/sqlite";
import { embedPapers } from "../ingest/embed";
import { noFilter } from "../query/filter";
import { rankedSearch } from "../query/ranking";
import { arxivId, paperRecord } from "../testing/catalog";
import { dumpCatalog } from "../testing/dump";
import { keywordEmbedder } from "../testing/embedder";
import { fakeD1 } from "../testing/fake-d1";
import { fakeAi, fakeVectorize, padVector } from "../testing/fake-cloudflare";
import { createTableVectorIndex } from "../vectors/table-index";
import worker from "../worker";
import { exportForCloudflare, sqlLiteral } from "./export";
import { createVectorizeIndex } from "./vectorize";
import { createWorkersAiEmbedder } from "./workers-ai";

const model = "bge-small-en-v1.5";
const now = "2026-10-24T08:00:00.000Z";
const embedder = keywordEmbedder(["diffusion", "video", "robot", "attention"], model);

const openSqlite = async () => {
  const db = openSqliteDatabase(":memory:");

  await migrate(db, migrations);

  return db;
};

/** Runs each line of an exported SQL file as one statement. */
const apply = async (db: Database, content: string) => {
  for (const line of content.split("\n")) {
    if (line !== "") {
      await db.run(sql(line));
    }
  }
};

const ndjsonVector = z.object({ id: z.string(), values: z.array(z.number()) });

const seed = async (db: Database) => {
  await db.batch([
    writeListedPaper(
      { ...paperRecord("2610.00001", "Video diffusion"), abstract: "It's fast.\nLine two." },
      "hf_daily",
      now,
    ),
    writeListedPaper(paperRecord("2610.00002", "Robot diffusion policy"), "hf_daily", now),
    writeListedPaper(paperRecord("2610.00003", "Sparse attention"), "hf_daily", now),
    writeListedPaper(
      { ...paperRecord("2401.00004", "Old video robot"), publishedAt: "2024-01-01T00:00:00.000Z" },
      "hf_daily",
      now,
    ),
    writeListedLink({
      paperId: arxivId("2610.00002"),
      kind: "github",
      externalId: "a/b",
      url: "https://github.com/a/b",
      popularity: 120,
      lastActivityAt: null,
    }),
    writeSignal({
      paperId: arxivId("2610.00001"),
      source: "hf_daily_upvotes",
      observedOn: "2026-10-23",
      score: 40,
    }),
    ...tagPaper(arxivId("2610.00003"), ["reading"], now),
    ...syncPaperConcepts(
      arxivId("2610.00001"),
      [{ kind: "task", slug: "video-generation", name: "Video Generation" }],
      now,
    ),
  ]);
  await embedPapers(db, embedder, createTableVectorIndex(db, model), {
    now,
    limit: 100,
    batchSize: 10,
  });
};

describe("sqlLiteral", () => {
  test("quotes text, keeps each statement on one line, and writes BLOBs as hex", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(42)).toBe("42");
    expect(sqlLiteral(1.5)).toBe("1.5");
    expect(sqlLiteral("1")).toBe("'1'");
    expect(sqlLiteral("it's\na")).toBe("'it''s' || char(10) || 'a'");
    expect(sqlLiteral(Uint8Array.from([0, 255]))).toBe("X'00ff'");
    expect(() => sqlLiteral(Number.NaN)).toThrow("Cannot export the number NaN");
  });
});

describe("exportForCloudflare", () => {
  let local: Database;

  beforeEach(async () => {
    local = await openSqlite();
    await seed(local);
  });

  test("copies the catalog to a fresh database, and a second copy changes nothing", async () => {
    const files = await exportForCloudflare(local, {
      model,
      vectorsSince: "2000-01-01",
      rowsPerFile: 5,
    });

    const cloud = createD1Database(fakeD1(await openSqlite()));

    expect(files.map(({ name }) => name)).toEqual([
      "catalog-001.sql",
      "catalog-002.sql",
      "catalog-003.sql",
      "vectors.ndjson",
    ]);

    for (const file of files.slice(0, -1)) {
      await apply(cloud, file.content);
    }

    expect(await dumpCatalog(cloud)).toEqual(await dumpCatalog(local));

    const copied = await dumpCatalog(cloud);

    for (const file of files.slice(0, -1)) {
      await apply(cloud, file.content);
    }

    expect(await dumpCatalog(cloud)).toEqual(copied);

    const search = await rankedSearch(
      cloud,
      { embedder, index: createTableVectorIndex(cloud, model) },
      { query: "line two", mode: "keyword", limit: 5, filter: noFilter, now: new Date(now) },
    );

    expect(search.map(({ paper }) => `${paper.id}`)).toEqual(["2610.00001"]);
  });

  test("exports vectors and embedding records only for recent papers", async () => {
    const files = await exportForCloudflare(local, {
      model,
      vectorsSince: "2026-01-01",
      rowsPerFile: 1000,
    });

    const vectors = (files.at(-1)?.content ?? "")
      .trim()
      .split("\n")
      .map((line) => ndjsonVector.parse(JSON.parse(line)));

    expect(vectors.map(({ id }) => id)).toEqual(["2610.00001", "2610.00002", "2610.00003"]);
    expect(vectors[0]?.values).toHaveLength(5);
    expect(files[0]?.content).not.toContain("'2401.00004', 'bge-small-en-v1.5'");
  });
});

describe("Cloudflare implementations", () => {
  test("the Vectorize index upserts, deletes, and queries in Vectorize batches", async () => {
    const vectorize = fakeVectorize();
    const index = createVectorizeIndex(vectorize, model);

    const entries = Array.from({ length: 1001 }, (_, n) => ({
      id: `id-${String(n).padStart(4, "0")}`,
      vector: Float32Array.from([1, n]),
    }));

    await index.upsert(entries);
    expect(vectorize.vectors.size).toBe(1001);
    expect(await index.query(Float32Array.from([0, 1]), 500)).toHaveLength(100);
    expect((await index.query(Float32Array.from([1, 0]), 1))[0]?.id).toBe("id-0000");

    await index.delete(entries.map(({ id }) => id));
    expect(vectorize.vectors.size).toBe(0);
  });

  test("the Workers AI embedder asks for the pooling of the model, in batches of 100", async () => {
    const ai = fakeAi(embedder, 5);

    const workersAi = createWorkersAiEmbedder(ai, {
      name: model,
      huggingFaceId: "x",
      queryPrefix: "query: ",
      pooling: "cls",
      dimensions: 5,
      workersAiId: "@cf/baai/bge-small-en-v1.5",
    });

    expect(await workersAi.embedDocuments(Array.from({ length: 150 }, () => "video"))).toHaveLength(
      150,
    );
    expect(Array.from(await workersAi.embedQuery("robot"))).toEqual([
      0, 0, 1, 0, 0.10000000149011612,
    ]);
    expect(ai.calls).toEqual([
      "@cf/baai/bge-small-en-v1.5 cls 100",
      "@cf/baai/bge-small-en-v1.5 cls 50",
      "@cf/baai/bge-small-en-v1.5 cls 1",
    ]);
  });

  test("the Workers AI embedder rejects a model that Workers AI does not have", () => {
    expect(() =>
      createWorkersAiEmbedder(fakeAi(embedder, 4), {
        name: "x",
        huggingFaceId: "x",
        queryPrefix: "",
        pooling: "mean",
        dimensions: 4,
        workersAiId: null,
      }),
    ).toThrow("x is not available in Workers AI");
  });
});

describe("worker", () => {
  test("gives the same top results as local search for the same data", async () => {
    const local = await openSqlite();

    await seed(local);

    const files = await exportForCloudflare(local, {
      model,
      vectorsSince: "2000-01-01",
      rowsPerFile: 1000,
    });

    const d1 = fakeD1(await openSqlite());
    const vectorize = fakeVectorize();

    for (const file of files.slice(0, -1)) {
      await apply(createD1Database(d1), file.content);
    }

    await vectorize.upsert(
      (files.at(-1)?.content ?? "")
        .trim()
        .split("\n")
        .map((line) => {
          const { id, values } = ndjsonVector.parse(JSON.parse(line));

          return { id, values: padVector(values, 384) };
        }),
    );

    const env = { DB: d1, VECTORIZE: vectorize, AI: fakeAi(embedder, 384) };
    const hits = z.object({ hits: z.array(z.object({ paper: z.object({ id: z.string() }) })) });

    for (const [query, mode] of [
      ["video diffusion", "hybrid"],
      ["robot", "semantic"],
      ["attention", "keyword"],
      ["diffusion", "hybrid"],
    ] as const) {
      const response = await worker.fetch(
        new Request(
          `https://pwc.example/search?q=${encodeURIComponent(query)}&mode=${mode}&limit=3`,
        ),
        env,
      );

      const remote = hits.parse(await response.json()).hits.map(({ paper }) => paper.id);

      const expected = await rankedSearch(
        local,
        { embedder, index: createTableVectorIndex(local, model) },
        { query, mode, limit: 3, filter: noFilter, now: new Date() },
      );

      expect(remote).toEqual(expected.map(({ paper }) => `${paper.id}`));
      expect(remote.length).toBeGreaterThan(0);
    }

    const paper = await worker.fetch(new Request("https://pwc.example/papers/2610.00001"), env);

    expect(paper.status).toBe(200);
  });
});
