import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { fakeHttp } from "../testing/fake-http";
import { SourceHttpError, SourceParseError, bearer, getJson, request } from "./http";

const options = { source: "Test", url: "https://example.com/a", headers: bearer("secret") };

describe("request", () => {
  test("retries rate limit and server errors with backoff", async () => {
    const statuses = [429, 503, 200];
    const http = fakeHttp(() => new Response("ok", { status: statuses.shift() ?? 500 }));

    expect(await (await request(http.client, options)).text()).toBe("ok");
    expect(http.sleeps).toEqual([1000, 2000]);
    expect(http.requests[0]?.headers).toEqual({ authorization: "Bearer secret" });
  });

  test("stops after three attempts", async () => {
    const http = fakeHttp(() => new Response("", { status: 500 }));

    await expect(request(http.client, options)).rejects.toThrow(SourceHttpError);
    expect(http.requests.length).toBe(3);
  });

  test("does not retry a client error", async () => {
    const http = fakeHttp(() => new Response("", { status: 404 }));

    await expect(request(http.client, options)).rejects.toThrow("HTTP 404");
    expect(http.requests.length).toBe(1);
  });
});

describe("getJson", () => {
  test("names each bad field in a parse error", async () => {
    const http = fakeHttp(() => new Response(JSON.stringify([{ id: 1, items: [{ name: 2 }] }])));

    const schema = z.array(
      z.object({ id: z.string(), items: z.array(z.object({ name: z.string() })) }),
    );

    const result = getJson(http.client, options, schema);

    await expect(result).rejects.toThrow(SourceParseError);
    await expect(result).rejects.toThrow(/0\.id: .*\n.*0\.items\.0\.name: /);
  });

  test("sends no authorization header without a token", () => {
    expect(bearer(null)).toEqual({});
  });
});
