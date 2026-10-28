import { beforeEach, describe, expect, test } from "bun:test";

import { writeListedPaper } from "../catalog/write";
import type { Database } from "../db/database";
import { getPaper } from "../query/papers";
import { createRateLimiter } from "../sources/rate-limit";
import { arxivId, openTestCatalog, paperRecord } from "../testing/catalog";
import { dumpCatalog } from "../testing/dump";
import { type FakeHttp, fakeHttp, jsonResponse } from "../testing/fake-http";
import { ingestConcepts } from "./pwc";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`;

const options = (now: string) => ({ now, limit: 10, staleDays: 30, retryDays: 3 });

const answer = (
  tasks: { slug: string; name: string }[],
  methods: { slug: string; name: string }[] = [],
) => jsonResponse(JSON.stringify({ arxiv_id: "x", tasks, methods }));

describe("ingestConcepts", () => {
  let db: Database;
  let replies: Map<string, () => Response>;
  let http: FakeHttp;

  const run = async (now: string) =>
    ingestConcepts(
      db,
      http.client,
      createRateLimiter(1000, http.client.sleep, () => 0),
      options(now),
    );

  const concepts = async (id: string) =>
    (await getPaper(db, arxivId(id)))?.concepts.map(
      ({ kind, slug, name }) => `${kind}:${slug}:${name}`,
    );

  beforeEach(async () => {
    db = await openTestCatalog();
    await db.batch([
      writeListedPaper(paperRecord("2610.00001", "One"), "hf_daily", day(1)),
      writeListedPaper(paperRecord("2610.00002", "Two"), "hf_daily", day(1)),
    ]);
    replies = new Map([
      [
        "2610.00001",
        () =>
          answer(
            [{ slug: "object-detection", name: "Object Detection" }],
            [{ slug: "dropout", name: "Dropout" }],
          ),
      ],
    ]);
    http = fakeHttp((url) => replies.get(url.split("/").at(-1) ?? "")?.());
  });

  test("stores tasks and methods, and a second run changes nothing", async () => {
    expect(await run(day(2))).toEqual({ found: 1, notFound: 1, concepts: 2 });
    expect(await concepts("2610.00001")).toEqual([
      "task:object-detection:Object Detection",
      "method:dropout:Dropout",
    ]);

    const stored = await dumpCatalog(db);

    expect(await run(day(2))).toEqual({ found: 0, notFound: 0, concepts: 0 });
    expect(await dumpCatalog(db)).toEqual(stored);
  });

  test("looks up a missing paper again after the retry days, and a found one after the stale days", async () => {
    await run(day(2));
    replies.set("2610.00002", () => answer([{ slug: "ocr", name: "OCR" }]));

    expect(await run(day(4))).toEqual({ found: 0, notFound: 0, concepts: 0 });
    expect(await run(day(6))).toEqual({ found: 1, notFound: 0, concepts: 1 });
    expect(await concepts("2610.00002")).toEqual(["task:ocr:OCR"]);
    expect((await run("2026-11-02T00:00:00.000Z")).found).toBe(1);
  });

  test("replaces removed concepts and renames a concept in place", async () => {
    await run(day(2));
    replies.set("2610.00001", () =>
      answer([{ slug: "object-detection", name: "Object detection" }]),
    );

    await run("2026-11-02T00:00:00.000Z");

    expect(await concepts("2610.00001")).toEqual(["task:object-detection:Object detection"]);
  });

  test("keeps earlier concepts when a paper is not found later", async () => {
    await run(day(2));
    replies.delete("2610.00001");

    await run("2026-11-02T00:00:00.000Z");

    expect(await concepts("2610.00001")).toHaveLength(2);
  });

  test("waits between requests", async () => {
    await run(day(2));

    expect(http.requests).toHaveLength(2);
    expect(http.sleeps).toEqual([1000]);
  });

  test("stops at the limit", async () => {
    const result = await ingestConcepts(
      db,
      http.client,
      createRateLimiter(1000, http.client.sleep, () => 0),
      { ...options(day(2)), limit: 1 },
    );

    expect(result.found + result.notFound).toBe(1);
    expect(http.requests).toHaveLength(1);
  });
});
