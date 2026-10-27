import { describe, expect, test } from "bun:test";

import { arxivId } from "../testing/catalog";
import { fakeHttp, jsonResponse, readFixture } from "../testing/fake-http";
import { fetchDailyPapers } from "./hf-daily";
import { SourceParseError } from "./http";

const fixture = await readFixture("hf-daily-2026-10-23.json");
const url = "https://huggingface.co/api/daily_papers?date=2026-10-23";

describe("fetchDailyPapers", () => {
  test("maps each entry to a paper, links, and an upvote signal", async () => {
    const http = fakeHttp((requested) => (requested === url ? jsonResponse(fixture) : undefined));
    const page = await fetchDailyPapers(http.client, "2026-10-23", null);

    expect(page.skippedIds).toEqual([]);
    expect(page.entries.map(({ paper }) => `${paper.id}`)).toEqual([
      "2610.31329",
      "2610.30926",
      "2610.30181",
      "2610.24738",
      "2610.30949",
    ]);

    const [first] = page.entries;

    expect(first?.paper).toMatchObject({
      id: arxivId("2610.31329"),
      version: null,
      title: "WeVisOne-VL: Unified Visual Perception from Objects to Pixels",
      publishedAt: "2026-10-22T00:00:00.000Z",
    });
    expect(first?.paper.authors).toEqual(["Tianming Liang", "Junyi Pan", "Yuxi Li", "Canmiao Fu"]);
    expect(first?.paper.categories).toEqual([]);
    expect(first?.paper.abstract).toStartWith("Existing vision-language models (VLMs)");
    expect(first?.links).toEqual([
      {
        paperId: arxivId("2610.31329"),
        kind: "github",
        externalId: "tencent/wevisone-vl",
        url: "https://github.com/Tencent/WeVisOne-VL",
        popularity: 291,
        lastActivityAt: null,
      },
      {
        paperId: arxivId("2610.31329"),
        kind: "project_page",
        externalId: "tencent.github.io/wevisone-vl",
        url: "https://tencent.github.io/WeVisOne-VL",
        popularity: null,
        lastActivityAt: null,
      },
    ]);
    expect(first?.signal).toEqual({
      paperId: arxivId("2610.31329"),
      source: "hf_daily_upvotes",
      observedOn: "2026-10-23",
      score: 255,
    });
    expect(page.entries[3]?.links).toEqual([]);
  });

  test("sends the token as a bearer header", async () => {
    const http = fakeHttp(() => jsonResponse("[]"));

    await fetchDailyPapers(http.client, "2026-10-25", "hf_token");
    expect(http.requests[0]?.headers.authorization).toBe("Bearer hf_token");
  });

  test("skips entries that have no arXiv ID", async () => {
    const entries = JSON.parse(fixture);

    entries[0].paper.id = "not-arxiv";

    const http = fakeHttp(() => jsonResponse(JSON.stringify(entries)));
    const page = await fetchDailyPapers(http.client, "2026-10-23", null);

    expect(page.skippedIds).toEqual(["not-arxiv"]);
    expect(page.entries.length).toBe(4);
  });

  test("names the bad field when the response does not match", async () => {
    const entries = JSON.parse(fixture);

    entries[2].paper.upvotes = "many";

    const http = fakeHttp(() => jsonResponse(JSON.stringify(entries)));
    const result = fetchDailyPapers(http.client, "2026-10-23", null);

    await expect(result).rejects.toThrow(SourceParseError);
    await expect(result).rejects.toThrow("2.paper.upvotes");
  });

  test("rejects a date that is not YYYY-MM-DD", async () => {
    const http = fakeHttp(() => jsonResponse("[]"));

    await expect(fetchDailyPapers(http.client, "2026-10-23&limit=1", null)).rejects.toThrow(
      RangeError,
    );
    expect(http.requests).toEqual([]);
  });
});
