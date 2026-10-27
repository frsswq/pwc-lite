import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { writeListedLink, writeListedPaper } from "../catalog/write";
import { type Database, sql } from "../db/database";
import { createRateLimiter } from "../sources/rate-limit";
import { arxivId, openTestCatalog, paperRecord } from "../testing/catalog";
import { type FakeHttp, fakeHttp, jsonResponse } from "../testing/fake-http";
import { type HubIngestOptions, ingestHub } from "./hf-hub";

const options: HubIngestOptions = {
  now: "2026-10-27T00:00:00.000Z",
  today: "2026-10-27",
  token: null,
  discover: false,
  retentionDays: 365,
  refreshLimit: 10,
  staleDays: 7,
};

const limiters = () => ({
  hub: createRateLimiter(
    0,
    async () => undefined,
    () => 0,
  ),
  arxiv: createRateLimiter(
    0,
    async () => undefined,
    () => 0,
  ),
});

const entry = (id: string) => `<entry>
  <id>http://arxiv.org/abs/${id}v1</id><title>Paper ${id}</title><summary>About ${id}.</summary>
  <published>2026-10-01T00:00:00Z</published><updated>2026-10-01T00:00:00Z</updated>
  <author><name>A</name></author><category term="cs.LG"/>
</entry>`;

const linkRow = z.object({
  kind: z.string(),
  external_id: z.string(),
  fetched_at: z.string().nullable(),
});

const readLinks = async (db: Database) =>
  db.all(sql("SELECT kind, external_id, fetched_at FROM links ORDER BY kind, external_id"), (row) =>
    linkRow.parse(row),
  );

const serve = (models: readonly string[]): FakeHttp =>
  fakeHttp((url) => {
    if (url.includes("/repos")) {
      return jsonResponse(JSON.stringify({ models: models.map((id) => ({ id, likes: 1 })) }));
    }

    if (url.startsWith("https://huggingface.co/api/models?")) {
      return jsonResponse(
        JSON.stringify([
          {
            tags: ["arxiv:2610.00001", "arxiv:2610.00002", "arxiv:2410.00003", "arxiv:1706.03762"],
          },
        ]),
      );
    }

    if (url.startsWith("https://huggingface.co/api/datasets?")) {
      return jsonResponse("[]");
    }

    if (url.startsWith("https://export.arxiv.org/")) {
      const ids = new URL(url).searchParams.get("id_list")?.split(",") ?? [];

      return new Response(
        `<feed xmlns="http://www.w3.org/2005/Atom"><title>q</title>${ids.map(entry).join("")}</feed>`,
      );
    }

    return undefined;
  });

describe("ingestHub", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openTestCatalog();
    await db.run(writeListedPaper(paperRecord("2610.00001", "Known"), "hf_daily", options.now));
  });

  test("discovers recent cited papers that are not in the catalog", async () => {
    const http = serve([]);
    const result = await ingestHub(db, http.client, limiters(), { ...options, discover: true });

    expect(result.discovered.map((id) => `${id}`)).toEqual(["2610.00002"]);
    expect(
      decodeURIComponent(http.requests.find(({ url }) => url.includes("arxiv.org"))?.url ?? ""),
    ).toContain("id_list=2610.00002&");
    expect(result.refreshed).toBe(2);
  });

  test("replaces Hub links and keeps links of other kinds", async () => {
    await db.batch([
      writeListedLink({
        paperId: arxivId("2610.00001"),
        kind: "github",
        externalId: "a/b",
        url: "https://github.com/a/b",
        popularity: 1,
        lastActivityAt: null,
      }),
    ]);
    await ingestHub(db, serve(["org/old", "org/kept"]).client, limiters(), options);
    await ingestHub(db, serve(["org/kept", "org/new"]).client, limiters(), {
      ...options,
      now: "2026-11-05T00:00:00.000Z",
      today: "2026-11-05",
    });

    expect(await readLinks(db)).toEqual([
      { kind: "github", external_id: "a/b", fetched_at: null },
      { kind: "hf_model", external_id: "org/kept", fetched_at: "2026-11-05T00:00:00.000Z" },
      { kind: "hf_model", external_id: "org/new", fetched_at: "2026-11-05T00:00:00.000Z" },
    ]);
  });

  test("refreshes a paper only when its links are older than the stale window", async () => {
    await ingestHub(db, serve(["org/a"]).client, limiters(), options);

    const soon = await ingestHub(db, serve(["org/a"]).client, limiters(), {
      ...options,
      today: "2026-11-02",
    });

    const later = await ingestHub(db, serve(["org/a"]).client, limiters(), {
      ...options,
      today: "2026-11-04",
    });

    expect(soon.refreshed).toBe(0);
    expect(later.refreshed).toBe(1);
  });

  test("respects the refresh limit, never fetched papers first", async () => {
    await db.run(writeListedPaper(paperRecord("2610.00005", "Second"), "hf_daily", options.now));
    await ingestHub(db, serve([]).client, limiters(), { ...options, refreshLimit: 1 });

    const http = serve([]);

    await ingestHub(db, http.client, limiters(), { ...options, refreshLimit: 1 });
    expect(http.requests.length).toBe(1);
  });
});
