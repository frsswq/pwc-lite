import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { writeListedPaper } from "../catalog/write";
import type { Database } from "../db/database";
import { openTestCatalog, paperRecord } from "../testing/catalog";
import { runTestCli } from "../testing/cli";
import { type FakeHttp, fakeHttp } from "../testing/fake-http";

const results = z.array(
  z.object({
    watch: z.object({ id: z.number(), query: z.string(), lastSeenAt: z.string() }),
    papers: z.array(z.object({ paper: z.object({ id: z.string() }) })),
  }),
);

describe("watch", () => {
  let db: Database;
  let http: FakeHttp;

  beforeEach(async () => {
    db = await openTestCatalog();
    http = fakeHttp(() => undefined);
    await db.batch([
      writeListedPaper(
        paperRecord("2610.00001", "Video diffusion"),
        "hf_daily",
        "2026-10-10T00:00:00.000Z",
      ),
      writeListedPaper(
        paperRecord("2610.00002", "Image diffusion"),
        "hf_daily",
        "2026-10-20T00:00:00.000Z",
      ),
      writeListedPaper(
        paperRecord("2610.00003", "Robot arms"),
        "hf_daily",
        "2026-10-20T00:00:00.000Z",
      ),
    ]);
  });

  const run = async (now: string, ...argv: string[]) => runTestCli(db, http, argv, { now });

  const newIds = async (now: string, ...argv: string[]) =>
    results
      .parse(JSON.parse((await run(now, "watch", "--json", ...argv)).stdout))
      .map(({ papers }) => papers.map(({ paper }) => paper.id));

  const ingest = async (id: string, title: string, at: string) => {
    await db.run(writeListedPaper(paperRecord(id, title), "hf_daily", at));
  };

  test("adds, lists, and removes watches", async () => {
    const now = "2026-10-24T00:00:00.000Z";

    expect((await run(now, "watch", "add", "diffusion")).stdout).toBe(
      'Added watch 1 for "diffusion". The first run shows papers ingested in the last 7 days.',
    );
    expect((await run(now, "watch", "add", "diffusion")).stderr).toBe(
      'Error: "diffusion" is already watched',
    );
    expect((await run(now, "watch", "add", "robot", "arms", "--days", "1")).code).toBe(0);
    expect((await run(now, "watch", "list")).stdout).toBe(
      [
        "  1  diffusion  (seen to 2026-10-17T00:00:00.000Z)",
        "  2  robot arms  (seen to 2026-10-23T00:00:00.000Z)",
      ].join("\n"),
    );
    expect((await run(now, "watch", "rm", "2")).stdout).toBe("Removed watch 2.");
    expect((await run(now, "watch", "rm", "2")).code).toBe(1);
    expect((await run(now, "watch", "rm", "x")).code).toBe(2);
    expect((await run(now, "watch", "add", "!!")).code).toBe(2);
    expect((await run(now, "watch", "fly")).code).toBe(2);
  });

  test("shows new papers once, then nothing until the next ingest", async () => {
    await run("2026-10-24T00:00:00.000Z", "watch", "add", "diffusion");

    expect(await newIds("2026-10-24T01:00:00.000Z")).toEqual([["2610.00002"]]);
    expect(await newIds("2026-10-24T02:00:00.000Z")).toEqual([[]]);

    await ingest("2610.00004", "Audio diffusion", "2026-10-25T00:00:00.000Z");
    await ingest("2610.00005", "Robot hands", "2026-10-25T00:00:00.000Z");

    expect(await newIds("2026-10-25T01:00:00.000Z")).toEqual([["2610.00004"]]);
    expect(await newIds("2026-10-25T02:00:00.000Z")).toEqual([[]]);
  });

  test("--dry-run shows the same papers on each run", async () => {
    await run("2026-10-24T00:00:00.000Z", "watch", "add", "diffusion", "--days", "30");

    const first = await newIds("2026-10-24T01:00:00.000Z", "--dry-run");

    expect(first).toEqual([["2610.00001", "2610.00002"]]);
    expect(await newIds("2026-10-24T02:00:00.000Z", "--dry-run")).toEqual(first);
    expect(await newIds("2026-10-24T03:00:00.000Z")).toEqual(first);
    expect(await newIds("2026-10-24T04:00:00.000Z")).toEqual([[]]);
  });

  test("prints new papers as text for each watch", async () => {
    await run("2026-10-24T00:00:00.000Z", "watch", "add", "robot");

    expect((await run("2026-10-24T01:00:00.000Z", "watch")).stdout).toBe(
      [
        "== 1: robot (1 new)",
        "",
        "2610.00003  2026-10-20",
        "            Robot arms",
        "            Ada Lovelace",
      ].join("\n"),
    );
    expect((await run("2026-10-24T02:00:00.000Z", "watch")).stdout).toBe(
      "== 1: robot (0 new)\n\nNo new papers.",
    );
  });
});
