import { z } from "zod";

import { markGithubChecked, writeGithubStats } from "../catalog/write";
import { type Database, sql } from "../db/database";
import { addDays } from "../domain/dates";
import { fetchRepoStats, rateLimitReserve } from "../sources/github";
import type { HttpClient } from "../sources/http";

export type GithubIngestOptions = {
  readonly now: string;
  /** Current UTC date as `YYYY-MM-DD`. */
  readonly today: string;
  readonly token: string | null;
  /** Most repositories that one run fetches. */
  readonly limit: number;
  /** Stats older than this many days are due for a refresh. */
  readonly staleDays: number;
};

export type GithubIngestResult = {
  readonly refreshed: number;
  readonly gone: readonly string[];
  /** Set when the run stopped early to stay inside the rate limit. */
  readonly rateLimitResetAt: string | null;
  readonly stoppedEarly: boolean;
};

const repoRow = z.object({ external_id: z.string() });

/** Lists repositories that were never fetched or have old stats, never fetched first. */
const dueRepos = async (db: Database, cutoff: string, limit: number): Promise<string[]> =>
  db.all(
    sql(
      `SELECT external_id, max(fetched_at IS NOT NULL) AS fetched, min(coalesce(fetched_at, '')) AS oldest
       FROM links WHERE kind = 'github'
       GROUP BY external_id
       HAVING min(coalesce(fetched_at, '')) < ?
       ORDER BY fetched, oldest, external_id
       LIMIT ?`,
      [cutoff, limit],
    ),
    (row) => repoRow.parse(row).external_id,
  );

/** Refreshes stars and the last push of linked GitHub repositories, and stops before the rate limit runs out. */
export const ingestGithub = async (
  db: Database,
  client: HttpClient,
  options: GithubIngestOptions,
): Promise<GithubIngestResult> => {
  const due = await dueRepos(db, addDays(options.today, -options.staleDays), options.limit);
  const gone: string[] = [];
  let refreshed = 0;
  let remaining: number | null = null;

  for (const repo of due) {
    if (remaining !== null && remaining <= rateLimitReserve) {
      return { refreshed, gone, rateLimitResetAt: null, stoppedEarly: true };
    }

    const result = await fetchRepoStats(client, repo, options.token);

    if (result.status === "rate_limited") {
      return { refreshed, gone, rateLimitResetAt: result.resetAt, stoppedEarly: true };
    }

    remaining = result.remaining;

    if (result.status === "gone") {
      gone.push(repo);
      await db.run(markGithubChecked(repo, options.now));
    } else {
      await db.run(writeGithubStats(repo, result.stats, options.now));
      refreshed += 1;
    }
  }

  return { refreshed, gone, rateLimitResetAt: null, stoppedEarly: false };
};
