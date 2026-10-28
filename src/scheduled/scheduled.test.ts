import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { type Database, sql } from "../db/database";
import { createD1Database } from "../db/d1";
import { migrate } from "../db/migrate";
import { migrations } from "../db/migrations/index";
import { openSqliteDatabase } from "../db/sqlite";
import { keywordEmbedder } from "../testing/embedder";
import { fakeAi, fakeVectorize } from "../testing/fake-cloudflare";
import { fakeD1 } from "../testing/fake-d1";
import { dumpCatalog } from "../testing/dump";
import { type FakeHttp, fakeHttp, jsonResponse, readFixture } from "../testing/fake-http";
import { runTestCli } from "../testing/cli";
import { handleScheduled } from "../worker";
import { nextJob, scheduledJobs } from "./scheduled";

const daily = await readFixture("hf-daily-2026-10-23.json");
const arxiv = await readFixture("arxiv-batch.xml");
const repos = await readFixture("hf-repos-2610.31329.json");
const pwcPaper = await readFixture("pwc-paper-2610.31329.json");

const now = "2026-10-24T08:00:00.000Z";

const embedder = keywordEmbedder(
  ["diffusion", "video", "pixel", "perception"],
  "bge-small-en-v1.5",
);

const sources = (): FakeHttp =>
  fakeHttp((url) => {
    if (url.startsWith("https://huggingface.co/api/daily_papers?date=")) {
      return jsonResponse(url.endsWith("2026-10-23") ? daily : "[]");
    }

    if (url.startsWith("https://export.arxiv.org/api/query?")) {
      return new Response(arxiv);
    }

    if (url === "https://huggingface.co/api/arxiv/2610.31329/repos") {
      return jsonResponse(repos);
    }

    if (url.startsWith("https://huggingface.co/api/arxiv/")) {
      return jsonResponse("{}");
    }

    if (url.startsWith("https://api.github.com/repos/")) {
      return jsonResponse(
        JSON.stringify({
          html_url: "https://github.com/x/y",
          stargazers_count: 7,
          pushed_at: null,
        }),
      );
    }

    return url === "https://paperswithcode.co/api/v1/papers/arxiv/2610.31329"
      ? jsonResponse(pwcPaper)
      : undefined;
  });

const runRow = z.object({
  job: z.string(),
  status: z.string(),
  result: z.string().nullable(),
  error: z.string().nullable(),
});

const openSqlite = async () => {
  const db = openSqliteDatabase(":memory:");

  await migrate(db, migrations);

  return db;
};

describe("scheduled ingest", () => {
  let sqlite: Database;
  let db: Database;
  let http: FakeHttp;
  let vectorize: ReturnType<typeof fakeVectorize>;
  let env: Parameters<typeof handleScheduled>[0];

  beforeEach(async () => {
    sqlite = await openSqlite();
    db = createD1Database(fakeD1(sqlite));
    http = sources();
    vectorize = fakeVectorize();
    env = { DB: fakeD1(sqlite), VECTORIZE: vectorize, AI: fakeAi(embedder, 384) };
  });

  const tick = async (at = now) => handleScheduled(env, http.client, () => new Date(at));

  const runs = async () =>
    db.all(sql("SELECT job, status, result, error FROM ingest_runs ORDER BY id"), (row) =>
      runRow.parse(row),
    );

  const cycles = async (count: number) => {
    for (let run = 0; run < count * scheduledJobs.length; run += 1) {
      await tick();
    }
  };

  test("takes the jobs in turn and records each run", async () => {
    expect(await nextJob(db)).toBe("daily");

    for (const job of scheduledJobs) {
      expect((await tick()).job).toBe(job);
    }

    expect((await tick()).job).toBe("daily");

    const recorded = await runs();

    expect(recorded.map(({ job }) => job)).toEqual([...scheduledJobs, "daily"]);
    expect(recorded.every(({ status }) => status === "ok")).toBeTrue();
    expect(JSON.parse(recorded[0]?.result ?? "null")).toEqual({
      dates: ["2026-10-17"],
      papers: 0,
      changes: 1,
    });
  });

  test("ingests the fixtures through D1 one date each run, then continues where it stopped", async () => {
    await cycles(7);

    const dailyRuns = (await runs()).flatMap(({ job, result }) =>
      job === "daily"
        ? [z.object({ dates: z.array(z.string()) }).parse(JSON.parse(result ?? "{}")).dates]
        : [],
    );

    expect(dailyRuns).toEqual([
      ["2026-10-17"],
      ["2026-10-18"],
      ["2026-10-19"],
      ["2026-10-20"],
      ["2026-10-21"],
      ["2026-10-22"],
      ["2026-10-23"],
    ]);

    const catalog = await dumpCatalog(db);

    expect(catalog.papers).toHaveLength(5);
    expect(catalog.papers.every((paper) => paper.arxiv_fetched_at === now)).toBeTrue();
    expect(catalog.embeddings).toHaveLength(5);
    expect(vectorize.vectors.size).toBe(5);
    expect(catalog.paperTags).toEqual([]);
    expect(catalog.links.some((link) => link.kind === "hf_model")).toBeTrue();
    expect(
      catalog.links.some((link) => link.kind === "github" && link.popularity === 7),
    ).toBeTrue();
    expect(
      await db.all(sql("SELECT count(*) AS count FROM paper_concepts"), (row) =>
        z.number().parse(row.count),
      ),
    ).toEqual([12]);

    await cycles(2);

    expect(await dumpCatalog(db)).toEqual(catalog);
  });

  test("stores the same papers as the local daily ingest", async () => {
    await cycles(7);

    const local = await openSqlite();

    await runTestCli(local, sources(), ["ingest", "daily", "--since", "2026-10-17"], { now });

    const cloud = await dumpCatalog(db);
    const expected = await dumpCatalog(local);

    expect(cloud.papers.map(({ pk: _pk, hub_fetched_at: _hub, ...paper }) => paper)).toEqual(
      expected.papers.map(({ pk: _pk, hub_fetched_at: _hub, ...paper }) => paper),
    );
    expect(cloud.signals).toEqual(expected.signals);
  });

  test("records a failed job, throws, and goes on with the next job", async () => {
    http = fakeHttp(() => new Response("down", { status: 500 }));

    await expect(tick()).rejects.toThrow("Hugging Face Daily Papers request failed with HTTP 500");
    expect(await runs()).toEqual([
      {
        job: "daily",
        status: "error",
        result: null,
        error: expect.stringContaining("HTTP 500"),
      },
    ]);
    expect((await tick()).job).toBe("arxiv");
  });

  test("maintain removes vectors of old papers and old run records", async () => {
    await cycles(7);

    expect(vectorize.vectors.size).toBe(5);

    const later = "2027-08-01T08:00:00.000Z";

    for (let run = 0; run < scheduledJobs.length; run += 1) {
      await tick(later);
    }

    const maintain = (await runs()).findLast(({ job }) => job === "maintain");

    expect(JSON.parse(maintain?.result ?? "null")).toMatchObject({ expiredVectors: 5 });
    expect(vectorize.vectors.size).toBe(0);
    expect((await dumpCatalog(db)).embeddings).toEqual([]);
    expect((await runs()).length).toBeLessThan(8 * scheduledJobs.length);
  });
});
