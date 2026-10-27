import { describe, expect, test } from "bun:test";

import { arxivId } from "../testing/catalog";
import { fakeHttp, readFixture } from "../testing/fake-http";
import { fetchArxivPapers, parseArxivFeed } from "./arxiv";
import { SourceParseError } from "./http";
import { createRateLimiter } from "./rate-limit";

const fixture = await readFixture("arxiv-batch.xml");

const feed = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><title>arXiv Query</title>${entries}</feed>`;

const recordingLimiter = () => {
  const sleeps: number[] = [];

  return {
    sleeps,
    limiter: createRateLimiter(
      3000,
      async (ms) => void sleeps.push(ms),
      () => 0,
    ),
  };
};

describe("parseArxivFeed", () => {
  test("maps the recorded feed to paper records", () => {
    const papers = parseArxivFeed(fixture);
    const byId = new Map(papers.map((paper) => [`${paper.id}`, paper]));

    expect([...byId.keys()].toSorted()).toEqual([
      "2610.24738",
      "2610.30181",
      "2610.30926",
      "2610.30949",
      "2610.31329",
      "cs/0112017",
    ]);
    expect(byId.get("2610.31329")).toMatchObject({
      version: 2,
      title: "WeVisOne-VL: Unified Visual Perception from Objects to Pixels",
      primaryCategory: "cs.CV",
      updatedAt: "2026-10-24T16:26:55.000Z",
    });
    expect(byId.get("2610.30181")?.categories).toEqual(["cs.IR", "cs.MM", "cs.SE"]);
    expect(byId.get("cs/0112017")).toMatchObject({
      version: 1,
      publishedAt: "2001-12-14T18:55:11.000Z",
      primaryCategory: "cs.DL",
      doi: null,
    });
    expect(byId.get("cs/0112017")?.authors).toEqual(["Naomi Dushay"]);
    expect(byId.get("cs/0112017")?.abstract).toStartWith(
      "With the increasing technical sophistication",
    );
  });

  test("reads DOI, collapses whitespace, and keeps numeric titles as text", () => {
    const [paper] = parseArxivFeed(
      feed(`<entry>
        <id>http://arxiv.org/abs/2101.00001v3</id>
        <title>1984</title>
        <summary>  Line one
          line two. </summary>
        <published>2021-01-01T00:00:00Z</published>
        <updated>2021-02-01T00:00:00Z</updated>
        <author><name>A  B</name></author>
        <author><name>C</name></author>
        <category term="cs.LG"/>
        <arxiv:doi>10.1000/xyz</arxiv:doi>
      </entry>`),
    );

    expect(paper).toMatchObject({
      version: 3,
      title: "1984",
      abstract: "Line one line two.",
      primaryCategory: "cs.LG",
      doi: "10.1000/xyz",
    });
    expect(paper?.authors).toEqual(["A B", "C"]);
  });

  test("returns no papers for an empty feed", () => {
    expect(parseArxivFeed(feed(""))).toEqual([]);
  });

  test("names the bad field when an entry does not match", () => {
    expect(() =>
      parseArxivFeed(feed("<entry><id>http://arxiv.org/abs/2101.00001</id></entry>")),
    ).toThrow(SourceParseError);
    expect(() =>
      parseArxivFeed(feed("<entry><id>http://arxiv.org/abs/2101.00001</id></entry>")),
    ).toThrow("feed.entry.0.title");
  });
});

describe("fetchArxivPapers", () => {
  test("reports requested IDs that arXiv did not return", async () => {
    const http = fakeHttp(() => new Response(fixture));
    const { limiter } = recordingLimiter();

    const ids = [
      "2610.31329",
      "2610.30926",
      "2610.30181",
      "2610.24738",
      "2610.30949",
      "cs/0112017",
      "2610.99999",
    ];

    const result = await fetchArxivPapers(http.client, limiter, ids.map(arxivId));

    expect(result.papers.length).toBe(6);
    expect(result.missingIds.map((id) => `${id}`)).toEqual(["2610.99999"]);
    expect(decodeURIComponent(http.requests[0]?.url ?? "")).toBe(
      `https://export.arxiv.org/api/query?id_list=${ids.join(",")}&max_results=7`,
    );
  });

  test("splits IDs into batches and waits between requests", async () => {
    const http = fakeHttp(() => new Response(feed("")));
    const { limiter, sleeps } = recordingLimiter();
    const ids = Array.from({ length: 120 }, (_, index) => arxivId(`2610.${String(10000 + index)}`));

    await fetchArxivPapers(http.client, limiter, [...ids, ...ids]);

    expect(http.requests.length).toBe(3);
    expect(sleeps).toEqual([3000, 3000]);
    expect(new URL(http.requests[2]?.url ?? "").searchParams.get("max_results")).toBe("20");
  });
});
