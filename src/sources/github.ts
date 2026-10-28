import { z } from "zod";

import { parseGithubRepo } from "../domain/link-urls";
import { type HttpClient, SourceHttpError, bearer, checked } from "./http";

const source = "GitHub";
const api = "https://api.github.com/repos";

/** Requests left in the rate limit window that a run never spends. */
export const rateLimitReserve = 5;

const githubHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "pwc-lite",
  "x-github-api-version": "2022-11-28",
};

const maxAttempts = 3;
const retryDelayMs = 1000;

const repoSchema = z.object({
  html_url: z.string(),
  stargazers_count: z.number().int().nonnegative(),
  pushed_at: z.iso.datetime({ offset: true }).nullable(),
});

export type RepoStats = {
  readonly url: string;
  readonly stars: number;
  /** Last push as ISO 8601 text, or null for an empty repository. */
  readonly pushedAt: string | null;
};

export type RepoResult =
  | { readonly status: "found"; readonly stats: RepoStats; readonly remaining: number | null }
  | { readonly status: "gone"; readonly remaining: number | null }
  | { readonly status: "rate_limited"; readonly resetAt: string | null };

const readRemaining = (response: Response): number | null => {
  const header = response.headers.get("x-ratelimit-remaining");

  return header === null || !/^\d+$/.test(header) ? null : Number(header);
};

const readReset = (response: Response): string | null => {
  const header = response.headers.get("x-ratelimit-reset");

  return header === null || !/^\d+$/.test(header)
    ? null
    : new Date(Number(header) * 1000).toISOString();
};

const isRateLimited = (response: Response) =>
  response.status === 429 || (response.status === 403 && readRemaining(response) === 0);

/**
 * Fetches stars and the last push of a repository given as `owner/repo`.
 *
 * GitHub follows renames with a redirect, so the result URL can differ from the request.
 * A missing, blocked, or private repository gives `gone` instead of an error.
 */
export const fetchRepoStats = async (
  client: HttpClient,
  repo: string,
  token: string | null,
): Promise<RepoResult> => {
  const url = `${api}/${repo}`;

  const headers = { ...githubHeaders, ...bearer(token) };

  for (let attempt = 1; ; attempt += 1) {
    const response = await client.fetch(url, { headers });

    if (isRateLimited(response)) {
      return { status: "rate_limited", resetAt: readReset(response) };
    }

    if (response.ok) {
      const body = checked(source, repoSchema.safeParse(await response.json()));
      const canonical = parseGithubRepo(body.html_url)?.url ?? body.html_url;

      return {
        status: "found",
        stats: {
          url: canonical,
          stars: body.stargazers_count,
          pushedAt: body.pushed_at === null ? null : new Date(body.pushed_at).toISOString(),
        },
        remaining: readRemaining(response),
      };
    }

    if ([403, 404, 410, 451].includes(response.status)) {
      return { status: "gone", remaining: readRemaining(response) };
    }

    if (response.status < 500 || attempt >= maxAttempts) {
      throw new SourceHttpError(source, url, response.status);
    }

    await client.sleep(retryDelayMs * 2 ** (attempt - 1));
  }
};
