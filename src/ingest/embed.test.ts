import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { writeArxivPaper, writeListedPaper } from "../catalog/write";
import { type Database, sql } from "../db/database";
import { keywordEmbedder } from "../testing/embedder";
import { openTestCatalog, paperRecord } from "../testing/catalog";
import { createTableVectorIndex } from "../vectors/table-index";
import { countPendingEmbeddings, embedPapers } from "./embed";

const now = "2026-10-24T08:00:00.000Z";

const embeddingRow = z.object({ paper_id: z.string(), model: z.string() });

const embeddings = async (db: Database) =>
  db.all(sql("SELECT paper_id, model FROM embeddings ORDER BY paper_id"), (row) =>
    embeddingRow.parse(row),
  );

describe("embedPapers", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openTestCatalog();
    await db.batch([
      writeListedPaper(paperRecord("2610.00001", "Video diffusion"), "hf_daily", now),
      writeListedPaper(paperRecord("2610.00002", "Sparse attention"), "hf_daily", now),
      writeListedPaper(paperRecord("2610.00003", "Robot diffusion policy"), "hf_daily", now),
    ]);
  });

  test("embeds every paper in batches and finds them by similarity", async () => {
    const embedder = keywordEmbedder(["diffusion", "attention", "robot"]);
    const index = createTableVectorIndex(db, embedder.model);

    expect(await embedPapers(db, embedder, index, { now, limit: 100, batchSize: 2 })).toEqual({
      embedded: 3,
      remaining: 0,
    });
    expect(embedder.calls.map((texts) => texts.length)).toEqual([2, 1]);
    expect(embedder.calls[0]?.[0]).toBe("Video diffusion\n\nAbstract of Video diffusion.");

    const matches = await index.query(await embedder.embedQuery("robot"), 2);

    expect(matches.map(({ id }) => id)).toEqual(["2610.00003", "2610.00001"]);
  });

  test("does nothing on a second run", async () => {
    const embedder = keywordEmbedder(["diffusion"]);
    const index = createTableVectorIndex(db, embedder.model);

    await embedPapers(db, embedder, index, { now, limit: 100, batchSize: 10 });

    expect(await embedPapers(db, embedder, index, { now, limit: 100, batchSize: 10 })).toEqual({
      embedded: 0,
      remaining: 0,
    });
    expect(embedder.calls).toHaveLength(1);
  });

  test("stops at the limit and reports the remaining papers", async () => {
    const embedder = keywordEmbedder(["diffusion"]);
    const index = createTableVectorIndex(db, embedder.model);

    expect(await embedPapers(db, embedder, index, { now, limit: 2, batchSize: 10 })).toEqual({
      embedded: 2,
      remaining: 1,
    });
  });

  test("marks vectors of another model as stale", async () => {
    const old = keywordEmbedder(["diffusion"], "old-model");

    await embedPapers(db, old, createTableVectorIndex(db, old.model), {
      now,
      limit: 100,
      batchSize: 10,
    });

    expect(await countPendingEmbeddings(db, "new-model")).toBe(3);

    const current = keywordEmbedder(["diffusion"], "new-model");
    const index = createTableVectorIndex(db, current.model);

    expect(await index.query(await current.embedQuery("diffusion"), 10)).toEqual([]);

    await embedPapers(db, current, index, { now, limit: 100, batchSize: 10 });

    expect((await embeddings(db)).map(({ model }) => model)).toEqual([
      "new-model",
      "new-model",
      "new-model",
    ]);
    expect(await index.query(await current.embedQuery("diffusion"), 10)).toHaveLength(3);
  });

  test("embeds a paper again when its title or abstract changes", async () => {
    const embedder = keywordEmbedder(["diffusion", "attention"]);
    const index = createTableVectorIndex(db, embedder.model);

    await embedPapers(db, embedder, index, { now, limit: 100, batchSize: 10 });
    await db.run(writeArxivPaper(paperRecord("2610.00001", "Video diffusion"), "hf_daily", now));

    expect(await countPendingEmbeddings(db, embedder.model)).toBe(0);

    await db.run(
      writeArxivPaper(paperRecord("2610.00002", "Sparse attention, revised"), "hf_daily", now),
    );

    expect(await countPendingEmbeddings(db, embedder.model)).toBe(1);
  });

  test("rejects an index of another model", async () => {
    const embedder = keywordEmbedder(["diffusion"], "a");

    await expect(
      embedPapers(db, embedder, createTableVectorIndex(db, "b"), { now, limit: 1, batchSize: 1 }),
    ).rejects.toThrow("The index is for b, but the embedder is a");
  });
});
