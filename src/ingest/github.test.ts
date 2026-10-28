import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { writeListedLink, writeListedPaper } from "../catalog/write";
import { type Database, sql } from "../db/database";
import { arxivId, openTestCatalog, paperRecord } from "../testing/catalog";
import { fakeHttp } from "../testing/fake-http";
import { type GithubIngestOptions, ingestGithub } from "./github";

const options: GithubIngestOptions = {
  now: "2026-10-27T00:00:00.000Z",
  today: "2026-10-27",
  token: null,
  limit: 10,
  staleDays: 7,
};

const repoBody = (name: string, stars: number) =>
  JSON.stringify({
    html_url: `https://github.com/${name}`,
    stargazers_count: stars,
    pushed_at: "2026-10-20T00:00:00Z",
  });

const githubLink = (paper: string, repo: string, popularity: number) =>
  writeListedLink({
    paperId: arxivId(paper),
    kind: "github",
    externalId: repo.toLowerCase(),
    url: `https://github.com/${repo}`,
    popularity,
    lastActivityAt: null,
  });

const linkRow = z.object({
  paper_id: z.string(),
  external_id: z.string(),
  url: z.string(),
  popularity: z.number().nullable(),
  fetched_at: z.string().nullable(),
});

const readLinks = async (db: Database) =>
  db.all(
    sql(
      "SELECT paper_id, external_id, url, popularity, fetched_at FROM links ORDER BY paper_id, external_id",
    ),
    (row) => linkRow.parse(row),
  );

const remainingHeader = (remaining: number) => ({
  headers: { "x-ratelimit-remaining": String(remaining) },
});

describe("ingestGithub", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openTestCatalog();
    await db.batch([
      writeListedPaper(paperRecord("2610.00001", "One"), "hf_daily", options.now),
      writeListedPaper(paperRecord("2610.00002", "Two"), "hf_daily", options.now),
      githubLink("2610.00001", "Org/Shared", 1),
      githubLink("2610.00002", "Org/Shared", 1),
      githubLink("2610.00002", "org/gone", 1),
    ]);
  });

  test("fetches each repository once and updates every link to it", async () => {
    const http = fakeHttp((url) =>
      url.endsWith("/org/shared")
        ? new Response(repoBody("Org/Shared", 500), remainingHeader(50))
        : undefined,
    );

    const result = await ingestGithub(db, http.client, options);

    expect(result).toEqual({
      refreshed: 1,
      gone: ["org/gone"],
      rateLimitResetAt: null,
      stoppedEarly: false,
    });
    expect(http.requests.length).toBe(2);
    expect(await readLinks(db)).toEqual([
      {
        paper_id: "2610.00001",
        external_id: "org/shared",
        url: "https://github.com/Org/Shared",
        popularity: 500,
        fetched_at: options.now,
      },
      {
        paper_id: "2610.00002",
        external_id: "org/gone",
        url: "https://github.com/org/gone",
        popularity: 1,
        fetched_at: options.now,
      },
      {
        paper_id: "2610.00002",
        external_id: "org/shared",
        url: "https://github.com/Org/Shared",
        popularity: 500,
        fetched_at: options.now,
      },
    ]);
  });

  test("listing popularity does not replace fetched stars", async () => {
    await ingestGithub(
      db,
      fakeHttp(() => new Response(repoBody("Org/Shared", 500))).client,
      options,
    );
    await db.run(githubLink("2610.00001", "Org/Shared", 2));

    expect((await readLinks(db))[0]?.popularity).toBe(500);
  });

  test("skips repositories fetched inside the stale window", async () => {
    await ingestGithub(
      db,
      fakeHttp(() => new Response(repoBody("Org/Shared", 500))).client,
      options,
    );

    const soon = fakeHttp(() => new Response(repoBody("Org/Shared", 500)));

    expect(
      (await ingestGithub(db, soon.client, { ...options, today: "2026-11-02" })).refreshed,
    ).toBe(0);
    expect(soon.requests).toEqual([]);
    expect(
      (await ingestGithub(db, soon.client, { ...options, today: "2026-11-04" })).refreshed,
    ).toBe(2);
  });

  test("stops when the remaining rate limit reaches the reserve", async () => {
    const http = fakeHttp(() => new Response(repoBody("Org/Shared", 500), remainingHeader(5)));
    const result = await ingestGithub(db, http.client, options);

    expect(result).toMatchObject({ refreshed: 1, stoppedEarly: true });
    expect(http.requests.length).toBe(1);
  });

  test("stops when GitHub reports that the limit is spent", async () => {
    const http = fakeHttp(
      () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    );

    const result = await ingestGithub(db, http.client, options);

    expect(result).toMatchObject({ refreshed: 0, gone: [], stoppedEarly: true });
    expect((await readLinks(db)).every(({ fetched_at }) => fetched_at === null)).toBe(true);
  });
});
