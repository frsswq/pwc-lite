import { describe, expect, test } from "bun:test";

import { arxivId } from "../testing/catalog";
import { fakeHttp, jsonResponse, readFixture } from "../testing/fake-http";
import { fetchPaperRepos, fetchTrendingArxivIds, maxLinksPerKind } from "./hf-hub";

const repos = await readFixture("hf-repos-2610.31329.json");
const trending = await readFixture("hf-trending-models.json");

describe("fetchPaperRepos", () => {
  test("maps models and Spaces to links, most liked first", async () => {
    const http = fakeHttp((url) =>
      url === "https://huggingface.co/api/arxiv/2610.31329/repos" ? jsonResponse(repos) : undefined,
    );

    const links = await fetchPaperRepos(http.client, arxivId("2610.31329"), "hf_x");

    expect(links.map(({ kind, externalId }) => `${kind} ${externalId}`)).toEqual([
      "hf_model tencent/WeVisOne-VL-4B",
      "hf_model tencent/WeVisOne-VL-2B",
      "hf_space tardellirs/paper-pulse",
      "hf_space hugging-apps/wevisone-vl-4b",
      "hf_space hugging-apps/wevisone-vl-2b",
      "hf_space liangtm/WeVisOne-VL",
    ]);
    expect(links[0]).toMatchObject({
      url: "https://huggingface.co/tencent/WeVisOne-VL-4B",
      popularity: 67,
      lastActivityAt: "2026-10-27T04:23:41.000Z",
    });
    expect(links[2]?.url).toBe("https://huggingface.co/spaces/tardellirs/paper-pulse");
    expect(http.requests[0]?.headers.authorization).toBe("Bearer hf_x");
  });

  test("keeps the most liked public repositories up to the limit", async () => {
    const models = Array.from({ length: 40 }, (_, index) => ({
      id: `org/m${index}`,
      likes: index,
    }));

    const body = JSON.stringify({
      models: [...models, { id: "org/secret", likes: 999, private: true }],
      datasets: [{ id: "org/data" }],
    });

    const links = await fetchPaperRepos(
      fakeHttp(() => jsonResponse(body)).client,
      arxivId("2610.00001"),
      null,
    );

    const modelLinks = links.filter(({ kind }) => kind === "hf_model");

    expect(modelLinks.length).toBe(maxLinksPerKind);
    expect(modelLinks[0]?.externalId).toBe("org/m39");
    expect(links.some(({ externalId }) => externalId === "org/secret")).toBe(false);
    expect(links.at(-1)).toMatchObject({
      kind: "hf_dataset",
      url: "https://huggingface.co/datasets/org/data",
      popularity: 0,
    });
  });
});

describe("fetchTrendingArxivIds", () => {
  test("collects cited arXiv IDs from models and datasets once each", async () => {
    const http = fakeHttp((url) => {
      if (url.startsWith("https://huggingface.co/api/models?")) {
        return jsonResponse(trending);
      }

      return url.startsWith("https://huggingface.co/api/datasets?")
        ? jsonResponse(
            JSON.stringify([{ tags: ["arxiv:2606.13392", "arxiv:2610.99998", "arxiv:bad"] }]),
          )
        : undefined;
    });

    const ids = await fetchTrendingArxivIds(http.client, null);

    expect(ids.map((id) => `${id}`)).toEqual([
      "2601.03233",
      "2606.13392",
      "2604.18556",
      "2605.00649",
      "2610.28578",
      "2610.23374",
      "2610.18010",
      "2610.99998",
    ]);
  });
});
