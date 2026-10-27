import type { HttpClient } from "../sources/http";

export type RecordedRequest = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
};

export type FakeHttp = {
  readonly client: HttpClient;
  readonly requests: RecordedRequest[];
  readonly sleeps: number[];
};

/** Answers each request from `respond`, and records requests and sleeps. Unknown URLs give HTTP 404. */
export const fakeHttp = (respond: (url: string) => Response | undefined): FakeHttp => {
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];

  return {
    requests,
    sleeps,
    client: {
      fetch: async (url, init) => {
        requests.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });

        return respond(url) ?? new Response("not found", { status: 404 });
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  };
};

export const jsonResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" } });

export const readFixture = async (name: string) =>
  Bun.file(new URL(`../../test/fixtures/${name}`, import.meta.url)).text();
