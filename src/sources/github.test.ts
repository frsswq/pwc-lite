import { describe, expect, test } from "bun:test";

import { fakeHttp, readFixture } from "../testing/fake-http";
import { fetchRepoStats } from "./github";
import { SourceParseError } from "./http";

const fixture = await readFixture("github-repo.json");

const reply = (status: number, body: string, remaining: string | null = "42") => {
  const headers = new Headers({
    "content-type": "application/json",
    "x-ratelimit-reset": "1793101025",
  });

  if (remaining !== null) {
    headers.set("x-ratelimit-remaining", remaining);
  }

  return new Response(body, { status, headers });
};

describe("fetchRepoStats", () => {
  test("reads stars, the last push, and the remaining rate limit", async () => {
    const http = fakeHttp(() => reply(200, fixture));
    const result = await fetchRepoStats(http.client, "tencent/wevisone-vl", "gh_x");

    expect(result).toEqual({
      status: "found",
      stats: {
        url: "https://github.com/Tencent/WeVisOne-VL",
        stars: 299,
        pushedAt: "2026-10-25T10:17:41.000Z",
      },
      remaining: 42,
    });
    expect(http.requests[0]?.url).toBe("https://api.github.com/repos/tencent/wevisone-vl");
    expect(http.requests[0]?.headers).toMatchObject({
      authorization: "Bearer gh_x",
      "user-agent": "pwc-lite",
    });
  });

  test("gives gone for a missing or blocked repository", async () => {
    for (const status of [404, 451]) {
      expect(await fetchRepoStats(fakeHttp(() => reply(status, "{}")).client, "a/b", null)).toEqual(
        {
          status: "gone",
          remaining: 42,
        },
      );
    }
  });

  test("gives rate_limited when the limit is spent", async () => {
    expect(await fetchRepoStats(fakeHttp(() => reply(403, "{}", "0")).client, "a/b", null)).toEqual(
      {
        status: "rate_limited",
        resetAt: "2026-10-27T11:37:05.000Z",
      },
    );
  });

  test("retries server errors", async () => {
    const statuses = [502, 200];
    const http = fakeHttp(() => reply(statuses.shift() ?? 500, fixture));

    expect((await fetchRepoStats(http.client, "a/b", null)).status).toBe("found");
    expect(http.sleeps).toEqual([1000]);
  });

  test("names the bad field when the body does not match", async () => {
    const result = fetchRepoStats(
      fakeHttp(() => reply(200, '{"html_url":"x"}')).client,
      "a/b",
      null,
    );

    await expect(result).rejects.toThrow(SourceParseError);
    await expect(result).rejects.toThrow("stargazers_count");
  });
});
