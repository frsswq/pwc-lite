import { beforeEach, describe, expect, test } from "bun:test";

import { writeListedLink, writeListedPaper } from "../catalog/write";
import type { Database } from "../db/database";
import { arxivId, openTestCatalog, paperRecord } from "../testing/catalog";
import { runTestCli } from "../testing/cli";
import { type FakeHttp, fakeHttp, jsonResponse, readFixture } from "../testing/fake-http";

const daily = await readFixture("hf-daily-2026-10-23.json");
const arxiv = await readFixture("arxiv-batch.xml");

const repos = await readFixture("hf-repos-2610.31329.json");

const sources = (): FakeHttp =>
  fakeHttp((url) => {
    if (url.startsWith("https://api.github.com/repos/")) {
      return new Response(
        JSON.stringify({
          html_url: "https://github.com/x/y",
          stargazers_count: 7,
          pushed_at: null,
        }),
      );
    }

    if (url === "https://huggingface.co/api/arxiv/2610.31329/repos") {
      return jsonResponse(repos);
    }

    if (url.includes("/repos")) {
      return jsonResponse("{}");
    }

    if (url.startsWith("https://huggingface.co/api/daily_papers?date=")) {
      return jsonResponse(url.endsWith("2026-10-23") ? daily : "[]");
    }

    if (url.startsWith("https://api.github.com/repos/")) {
      return new Response(
        JSON.stringify({
          html_url: "https://github.com/x/y",
          stargazers_count: 7,
          pushed_at: null,
        }),
      );
    }

    if (
      url.startsWith("https://huggingface.co/api/models?") ||
      url.startsWith("https://huggingface.co/api/datasets?")
    ) {
      return jsonResponse("[]");
    }

    return url.startsWith("https://export.arxiv.org/api/query?") ? new Response(arxiv) : undefined;
  });

describe("pwc", () => {
  let db: Database;
  let http: FakeHttp;

  beforeEach(async () => {
    db = await openTestCatalog();
    http = sources();
  });

  const run = async (...argv: string[]) => runTestCli(db, http, argv);

  test("prints help and rejects unknown commands", async () => {
    const help = await run();

    expect(help.code).toBe(0);
    expect(help.stdout).toContain("search  Search titles, abstracts, and authors");
    expect((await run("help", "search")).stdout).toContain("pwc search <query>");
    expect((await run("search", "--help")).stdout).toContain("pwc search <query>");
    expect((await run("fly")).code).toBe(2);
  });

  test("ingests Daily Papers with arXiv metadata, then finds the papers", async () => {
    const ingest = await run("ingest", "daily", "--since", "2026-10-23");

    expect(ingest.code).toBe(0);
    expect(ingest.stderr).toContain("Daily Papers: 2 dates, 5 entries");
    expect(ingest.stderr).toContain("arXiv metadata: 5 stored, 0 not available yet.");

    const search = await run("search", "pixel", "perception");

    expect(search.code).toBe(0);
    expect(search.stdout).toStartWith("2610.31329  2026-10-22  ↑255 ★291\n");
    expect(search.stdout).toContain(
      "WeVisOne-VL: Unified Visual Perception from Objects to Pixels",
    );

    const show = await run("show", "https://arxiv.org/abs/2610.31329v2");

    expect(show.stdout).toContain(
      "2610.31329v2 · cs.CV · published 2026-10-22 · updated 2026-10-24",
    );
    expect(show.stdout).toContain("github        https://github.com/Tencent/WeVisOne-VL  291");
    expect(show.stdout).toContain("Upvotes: 255 (Daily Papers 2026-10-23)");
  });

  test("ingests Hub links and shows them", async () => {
    await run("ingest", "daily", "--since", "2026-10-23", "--skip-arxiv");

    const hub = await run("ingest", "hub", "--skip-discover");

    expect(hub.code).toBe(0);
    expect(hub.stderr).toBe("Hugging Face Hub: 0 papers discovered, 5 papers refreshed, 6 links.");
    expect((await run("show", "2610.31329")).stdout).toContain(
      "hf_model      https://huggingface.co/tencent/WeVisOne-VL-4B  67",
    );
  });

  test("ingests every source with ingest all", async () => {
    const all = await run("ingest", "all", "--since", "2026-10-23", "--json");

    expect(all.stderr).not.toContain("Error");
    expect(all.code).toBe(0);
    expect(all.stderr).toContain("Daily Papers: 2 dates, 5 entries");
    expect(all.stderr).toContain(
      "Hugging Face Hub: 0 papers discovered, 5 papers refreshed, 6 links.",
    );
    expect(all.stderr).toContain("GitHub: 3 repositories refreshed, 0 gone.");
    expect(Object.keys(JSON.parse(all.stdout))).toEqual(["daily", "arxiv", "hub", "github"]);
    expect((await run("ingest", "all", "--limit", "3")).code).toBe(2);
  });

  test("prints JSON for read commands", async () => {
    await run("ingest", "daily", "--since", "2026-10-23", "--skip-arxiv");

    const hits = JSON.parse((await run("search", "pixel", "--json")).stdout);
    const detail = JSON.parse((await run("show", "2610.31329", "--json")).stdout);
    const recent = JSON.parse((await run("recent", "--json", "--days", "30")).stdout);

    expect(hits[0].paper.id).toBe("2610.31329");
    expect(detail.links.length).toBe(2);
    expect(recent.length).toBe(5);
    expect(http.requests.some(({ url }) => url.includes("arxiv.org"))).toBe(false);
  });

  test("adds a paper from an arXiv URL and reports a missing paper", async () => {
    const added = await run("add", "https://arxiv.org/abs/cs/0112017v1");

    expect(added).toMatchObject({ code: 0, stdout: "Added cs/0112017" });

    const missing = await run("add", "2610.99999");

    expect(missing.code).toBe(1);
    expect(missing.stderr).toBe("Error: arXiv has no paper for 2610.99999");
  });

  test("reports bad input with the command usage", async () => {
    const badLimit = await run("search", "x", "--limit", "abc");

    expect(badLimit.code).toBe(2);
    expect(badLimit.stderr).toContain('--limit must be a positive whole number, got "abc"');
    expect(badLimit.stderr).toContain("Usage:\n  pwc search");
    expect((await run("show", "nope")).code).toBe(2);
    expect((await run("search", "x", "--colour")).code).toBe(2);
    expect((await run("ingest", "weekly")).code).toBe(2);

    const unknown = await run("show", "2610.99999");

    expect(unknown).toMatchObject({ code: 1 });
    expect(unknown.stderr).toContain('Run "pwc add 2610.99999" to add it.');
  });

  test("prune keeps a paper that has a link and removes an old paper that has none", async () => {
    const old = {
      ...paperRecord("2301.00001", "Old with link"),
      publishedAt: "2023-01-01T00:00:00.000Z",
    };

    const bare = {
      ...paperRecord("2301.00002", "Old without link"),
      publishedAt: "2023-01-01T00:00:00.000Z",
    };

    const fresh = paperRecord("2610.00003", "New without link");

    await db.batch([
      writeListedPaper(old, "hf_daily", "2023-01-02T00:00:00.000Z"),
      writeListedPaper(bare, "hf_daily", "2023-01-02T00:00:00.000Z"),
      writeListedPaper(fresh, "hf_daily", "2026-10-21T00:00:00.000Z"),
      writeListedLink({
        paperId: arxivId("2301.00001"),
        kind: "github",
        externalId: "a/b",
        url: "https://github.com/a/b",
        popularity: 1,
        lastActivityAt: null,
      }),
    ]);

    expect((await run("prune", "--dry-run")).stdout).toBe(
      "Would remove 1 papers published before 2025-10-24.",
    );
    expect((await run("prune")).stdout).toBe("Removed 1 papers published before 2025-10-24.");
    expect((await run("show", "2301.00001")).code).toBe(0);
    expect((await run("show", "2301.00002")).code).toBe(1);
    expect((await run("show", "2610.00003")).code).toBe(0);
  });
});
