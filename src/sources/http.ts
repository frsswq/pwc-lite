import type { z } from "zod";

/** The subset of `fetch` that adapters use, so tests can pass a fake. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type Sleep = (ms: number) => Promise<void>;

export type HttpClient = {
  readonly fetch: Fetch;
  readonly sleep: Sleep;
};

export const defaultHttpClient: HttpClient = {
  fetch: async (url, init) => fetch(url, init),
  sleep: async (ms) => Bun.sleep(ms),
};

/** A source response that does not match its schema. */
export class SourceParseError extends Error {
  override readonly name = "SourceParseError";

  constructor(source: string, error: z.ZodError) {
    const details = error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );

    super(`${source} response does not match its schema:\n  ${details.join("\n  ")}`);
  }
}

/** A source request that failed with an HTTP status after all retries. */
export class SourceHttpError extends Error {
  override readonly name = "SourceHttpError";
  readonly status: number;

  constructor(source: string, url: string, status: number) {
    super(`${source} request failed with HTTP ${status}: ${url}`);
    this.status = status;
  }
}

/** Returns a bearer authorization header when a token is set. */
export const bearer = (token: string | null): RequestHeaders =>
  token === null ? {} : { authorization: `Bearer ${token}` };

const maxAttempts = 3;
const baseRetryDelayMs = 1000;

const isRetryable = (status: number) => status === 429 || status >= 500;

export type RequestHeaders = Readonly<Record<string, string>>;

export type RequestOptions = {
  readonly source: string;
  readonly url: string;
  readonly headers: RequestHeaders;
};

/** Fetches a URL and retries rate limit and server errors with exponential backoff. */
export const request = async (client: HttpClient, options: RequestOptions): Promise<Response> => {
  const init: RequestInit = { headers: { ...options.headers } };

  for (let attempt = 1; ; attempt += 1) {
    const response = await client.fetch(options.url, init);

    if (response.ok) {
      return response;
    }

    if (!isRetryable(response.status) || attempt >= maxAttempts) {
      throw new SourceHttpError(options.source, options.url, response.status);
    }

    await client.sleep(baseRetryDelayMs * 2 ** (attempt - 1));
  }
};

/** Returns parsed data, or throws a `SourceParseError` that names each bad field. */
export const checked = <Output>(source: string, result: z.ZodSafeParseResult<Output>): Output => {
  if (!result.success) {
    throw new SourceParseError(source, result.error);
  }

  return result.data;
};

export const getJson = async <Output>(
  client: HttpClient,
  options: RequestOptions,
  schema: z.ZodType<Output>,
): Promise<Output> => {
  const response = await request(client, options);

  return checked(options.source, schema.safeParse(await response.json()));
};
