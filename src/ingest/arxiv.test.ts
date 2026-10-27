import { expect, test } from "bun:test";
import { z } from "zod";

import { writeListedPaper } from "../catalog/write";
import { sql } from "../db/database";
import { createRateLimiter } from "../sources/rate-limit";
import { arxivId, openTestCatalog, paperRecord } from "../testing/catalog";
import { fakeHttp, readFixture } from "../testing/fake-http";
import { pendingArxivIds, storeArxivPapers } from "./arxiv";

const fixture = await readFixture("arxiv-batch.xml");

const limiter = () =>
  createRateLimiter(
    3000,
    async () => undefined,
    () => 0,
  );

const now = "2026-10-27T00:00:00.000Z";

const paperRow = z.object({
  id: z.string(),
  title: z.string(),
  primary_category: z.string().nullable(),
  added_via: z.string(),
  arxiv_fetched_at: z.string().nullable(),
});

test("stores arXiv metadata over listed metadata and adds new papers", async () => {
  const db = await openTestCatalog();

  await db.run(writeListedPaper(paperRecord("2610.31329", "Listed title"), "hf_daily", now));
  expect((await pendingArxivIds(db, 10)).map((id) => `${id}`)).toEqual(["2610.31329"]);

  const result = await storeArxivPapers(
    db,
    fakeHttp(() => new Response(fixture)).client,
    limiter(),
    [arxivId("2610.31329"), arxivId("cs/0112017"), arxivId("2610.99999")],
    "manual",
    now,
  );

  expect(result.missing.map((id) => `${id}`)).toEqual(["2610.99999"]);

  const rows = await db.all(
    sql(
      "SELECT id, title, primary_category, added_via, arxiv_fetched_at FROM papers WHERE id IN (?, ?) ORDER BY id",
      ["2610.31329", "cs/0112017"],
    ),
    (row) => paperRow.parse(row),
  );

  expect(rows).toEqual([
    {
      id: "2610.31329",
      title: "WeVisOne-VL: Unified Visual Perception from Objects to Pixels",
      primary_category: "cs.CV",
      added_via: "hf_daily",
      arxiv_fetched_at: now,
    },
    {
      id: "cs/0112017",
      title: "Using Structural Metadata to Localize Experience of Digital Content",
      primary_category: "cs.DL",
      added_via: "manual",
      arxiv_fetched_at: now,
    },
  ]);
  expect(await pendingArxivIds(db, 10)).toEqual([]);
});
