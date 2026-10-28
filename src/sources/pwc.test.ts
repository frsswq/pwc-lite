import { describe, expect, test } from "bun:test";

import { arxivId } from "../testing/catalog";
import { fakeHttp, jsonResponse, readFixture } from "../testing/fake-http";
import { SourceHttpError, SourceParseError } from "./http";
import { fetchPaperConcepts } from "./pwc";

const fixture = await readFixture("pwc-paper-2610.31329.json");

describe("fetchPaperConcepts", () => {
  test("reads the tasks and methods of a recorded paper", async () => {
    const http = fakeHttp(() => jsonResponse(fixture));
    const result = await fetchPaperConcepts(http.client, arxivId("2610.31329"));

    expect(http.requests.map(({ url }) => url)).toEqual([
      "https://paperswithcode.co/api/v1/papers/arxiv/2610.31329",
    ]);

    if (result.status !== "found") {
      throw new Error("Expected found");
    }

    expect(result.concepts).toHaveLength(12);
    expect(result.concepts[0]).toEqual({
      kind: "task",
      slug: "image-matting",
      name: "Image Matting",
    });
    expect(result.concepts.at(-1)).toEqual({
      kind: "method",
      slug: "vision-language-model-vlm",
      name: "Vision-language model (VLM)",
    });
  });

  test("treats null task and method lists as empty", async () => {
    const http = fakeHttp(() =>
      jsonResponse(JSON.stringify({ arxiv_id: "2610.00001", tasks: null, methods: null })),
    );

    expect(await fetchPaperConcepts(http.client, arxivId("2610.00001"))).toEqual({
      status: "found",
      concepts: [],
    });
  });

  test("gives not_found for an unknown paper", async () => {
    const http = fakeHttp(() => undefined);

    expect(await fetchPaperConcepts(http.client, arxivId("2610.99999"))).toEqual({
      status: "not_found",
    });
  });

  test("retries server errors, then fails", async () => {
    const http = fakeHttp(() => new Response("busy", { status: 503 }));

    await expect(fetchPaperConcepts(http.client, arxivId("2610.00001"))).rejects.toBeInstanceOf(
      SourceHttpError,
    );
    expect(http.requests).toHaveLength(3);
  });

  test("rejects a response of the wrong shape", async () => {
    const http = fakeHttp(() => jsonResponse(JSON.stringify({ arxiv_id: 1, tasks: "x" })));

    await expect(fetchPaperConcepts(http.client, arxivId("2610.00001"))).rejects.toBeInstanceOf(
      SourceParseError,
    );
  });
});
