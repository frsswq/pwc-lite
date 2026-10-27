import { describe, expect, test } from "bun:test";

import { parseGithubRepo, parseWebPage } from "./link-urls";

describe("parseGithubRepo", () => {
  test.each([
    [
      "https://github.com/Tencent/WeVisOne-VL",
      "tencent/wevisone-vl",
      "https://github.com/Tencent/WeVisOne-VL",
    ],
    ["https://github.com/a-b/c.d.git", "a-b/c.d", "https://github.com/a-b/c.d"],
    [
      "https://www.github.com/owner/repo/tree/main/src",
      "owner/repo",
      "https://github.com/owner/repo",
    ],
    [" http://github.com/owner/repo/ ", "owner/repo", "https://github.com/owner/repo"],
  ])("parses %p", (input, externalId, url) => {
    expect(parseGithubRepo(input)).toEqual({ externalId, url });
  });

  test.each([
    "https://github.com/owner",
    "https://gitlab.com/a/b",
    "github.com/a/b",
    "https://github.com/a/b%20c",
    "",
  ])("rejects %p", (input) => {
    expect(parseGithubRepo(input)).toBeNull();
  });
});

describe("parseWebPage", () => {
  test("drops the fragment and the final slash, and lowercases the ID", () => {
    expect(parseWebPage("https://Shotverse.github.io/fapl/#demo")).toEqual({
      externalId: "shotverse.github.io/fapl",
      url: "https://shotverse.github.io/fapl",
    });
  });

  test.each(["ftp://example.com/a", "mailto:a@b.c", "not a url"])("rejects %p", (input) => {
    expect(parseWebPage(input)).toBeNull();
  });
});
