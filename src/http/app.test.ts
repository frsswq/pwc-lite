import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { writeListedPaper } from "../catalog/write";
import type { Database } from "../db/database";
import { embedPapers } from "../ingest/embed";
import { openTestCatalog, paperRecord } from "../testing/catalog";
import { keywordEmbedder } from "../testing/embedder";
import { createTableVectorIndex } from "../vectors/table-index";
import { createApp } from "./app";

const paperBody = z.object({ id: z.string(), title: z.string() });

const hitsBody = z.object({
  hits: z.array(
    z.object({
      paper: paperBody,
      parts: z.object({ keywordRank: z.number().nullable(), semanticRank: z.number().nullable() }),
    }),
  ),
});

const detailBody = z.object({ paper: paperBody });

const recentBody = z.object({ papers: z.array(z.object({ paper: paperBody })) });

const errorBody = z.object({ error: z.string() });

const now = new Date("2026-10-24T08:00:00.000Z");

describe("createApp", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await openTestCatalog();

    const embedder = keywordEmbedder(["diffusion", "robot"]);
    const index = createTableVectorIndex(db, embedder.model);

    await db.batch([
      writeListedPaper(paperRecord("2610.00001", "Video diffusion"), "hf_daily", now.toISOString()),
      writeListedPaper(paperRecord("2610.00002", "Robot policies"), "hf_daily", now.toISOString()),
    ]);
    await embedPapers(db, embedder, index, {
      now: now.toISOString(),
      limit: 10,
      batchSize: 10,
      publishedSince: null,
    });
    app = createApp({ db, embedder, index, now: () => now });
  });

  const get = async <Body>(path: string, schema: z.ZodType<Body>) => {
    const response = await app.request(path);

    return { status: response.status, body: schema.parse(await response.json()) };
  };

  const fail = async (path: string) => get(path, errorBody);

  test("searches in hybrid mode by default", async () => {
    const { status, body } = await get("/search?q=robot", hitsBody);

    expect(status).toBe(200);
    expect(body.hits[0]?.paper.id).toBe("2610.00002");
    expect(body.hits[0]?.parts).toMatchObject({ keywordRank: 1, semanticRank: 1 });
  });

  test("accepts mode, limit, and since", async () => {
    const { body } = await get(
      "/search?q=diffusion&mode=keyword&limit=1&since=2026-10-01",
      hitsBody,
    );

    expect(body.hits.map((hit) => hit.paper.id)).toEqual(["2610.00001"]);
    expect(body.hits[0]?.parts.semanticRank).toBeNull();
  });

  test("rejects bad query parameters with a clear message", async () => {
    expect(await fail("/search")).toEqual({
      status: 400,
      body: { error: "q: Invalid input: expected string, received undefined" },
    });
    expect(await fail("/search?q=%20")).toEqual({
      status: 400,
      body: { error: "q: must not be empty" },
    });
    expect((await fail("/search?q=x&mode=fuzzy")).body.error).toStartWith("mode: Invalid option");
    expect(await fail("/search?q=x&limit=0")).toMatchObject({ status: 400 });
    expect(await fail("/search?q=x&since=2026-02-30")).toEqual({
      status: 400,
      body: { error: "since: must be a YYYY-MM-DD date" },
    });
    expect(await fail("/search?q=x&colour=red")).toEqual({
      status: 400,
      body: { error: 'colour: Unrecognized key: "colour"' },
    });
    expect(await fail("/recent?days=abc")).toMatchObject({ status: 400 });
  });

  test("looks up a paper by ID or URL", async () => {
    expect((await get("/papers/2610.00001", detailBody)).body.paper.title).toBe("Video diffusion");
    expect((await get("/papers/2610.00001v3", detailBody)).status).toBe(200);
    expect(
      (await get(`/papers/${encodeURIComponent("https://arxiv.org/abs/2610.00002")}`, detailBody))
        .body.paper.id,
    ).toBe("2610.00002");
    expect(await fail("/papers/2610.99999")).toEqual({
      status: 404,
      body: { error: "2610.99999 is not in the catalog" },
    });
    expect(await fail("/papers/not-an-id")).toEqual({
      status: 400,
      body: { error: "id: must be an arXiv ID" },
    });
  });

  test("lists recent papers", async () => {
    const { status, body } = await get("/recent?days=30&limit=1", recentBody);

    expect(status).toBe(200);
    expect(body.papers).toHaveLength(1);
  });

  test("answers unknown paths with 404", async () => {
    expect(await fail("/nope")).toEqual({ status: 404, body: { error: "Not found" } });
  });
});
