import { z } from "zod";

import { prunePapers } from "../catalog/prune";
import { type Database, sql } from "../db/database";
import { addDays, utcDate } from "../domain/dates";
import type { Embedder } from "../embed/embedder";
import { pendingArxivIds, storeArxivPapers } from "../ingest/arxiv";
import { embedPapers, expireEmbeddings } from "../ingest/embed";
import { ingestGithub } from "../ingest/github";
import { ingestDaily } from "../ingest/hf-daily";
import { ingestHub } from "../ingest/hf-hub";
import { ingestConcepts } from "../ingest/pwc";
import type { HttpClient } from "../sources/http";
import type { RateLimiter } from "../sources/rate-limit";
import type { VectorIndex } from "../vectors/vector-index";

/**
 * Jobs in the order that runs take them. Each run does one job, then the next run takes the next job.
 * `maintain` expires old vectors, prunes old papers, and removes old run records.
 */
export const scheduledJobs = [
  "daily",
  "arxiv",
  "embed",
  "hub",
  "github",
  "pwc",
  "maintain",
] as const;

export type ScheduledJob = (typeof scheduledJobs)[number];

/**
 * The work of one run. The Workers free plan allows 10 ms of CPU time and 50 subrequests for each run,
 * and each D1 query and each fetch is a subrequest. See issue #17.
 */
export const scheduledLimits = {
  dailyDates: 1,
  arxivPapers: 10,
  embedPapers: 16,
  hubPapers: 5,
  githubRepos: 10,
  pwcPapers: 10,
  expireVectors: 500,
  /** Vectorize on the free plan stores about 13,000 vectors of 384 dimensions. */
  vectorDays: 270,
  retentionDays: 365,
  keepRunsDays: 30,
} as const;

export type ScheduledDependencies = {
  readonly db: Database;
  readonly http: HttpClient;
  readonly embedder: Embedder;
  readonly index: VectorIndex;
  readonly limiters: {
    readonly arxiv: RateLimiter;
    readonly hub: RateLimiter;
    readonly pwc: RateLimiter;
  };
  readonly hfToken: string | null;
  readonly githubToken: string | null;
  readonly now: () => Date;
};

export type MaintainResult = {
  readonly expiredVectors: number;
  readonly prunedPapers: number;
  readonly removedRuns: number;
};

type JobResult = Readonly<Record<string, number | boolean | string | null | readonly string[]>>;

export type ScheduledRun = {
  readonly job: ScheduledJob;
  readonly status: "ok" | "error";
  readonly result: JobResult | null;
  readonly error: string | null;
};

const lastJobRow = z.object({ job: z.string() });

/** The job after the job of the last run, or the first job when there is no run. */
export const nextJob = async (db: Database): Promise<ScheduledJob> => {
  const last = await db.first(
    sql("SELECT job FROM ingest_runs ORDER BY id DESC LIMIT 1"),
    (row) => lastJobRow.parse(row).job,
  );

  const position = scheduledJobs.findIndex((job) => job === last);

  return scheduledJobs[(position + 1) % scheduledJobs.length] ?? "daily";
};

const runJob = async (job: ScheduledJob, deps: ScheduledDependencies): Promise<JobResult> => {
  const { db, http } = deps;
  const instant = deps.now();
  const now = instant.toISOString();
  const today = utcDate(instant);

  switch (job) {
    case "daily": {
      const result = await ingestDaily(db, http, {
        since: null,
        today,
        lookbackDays: 7,
        maxDates: scheduledLimits.dailyDates,
        token: deps.hfToken,
        now,
      });

      return { dates: result.dates, papers: result.papers, changes: result.changes };
    }

    case "arxiv": {
      const pending = await pendingArxivIds(db, scheduledLimits.arxivPapers);

      if (pending.length === 0) {
        return { stored: 0, missing: 0 };
      }

      const result = await storeArxivPapers(
        db,
        http,
        deps.limiters.arxiv,
        pending,
        "hf_daily",
        now,
      );

      return { stored: result.stored.length, missing: result.missing.length };
    }

    case "embed":
      return embedPapers(db, deps.embedder, deps.index, {
        now,
        limit: scheduledLimits.embedPapers,
        batchSize: scheduledLimits.embedPapers,
        publishedSince: addDays(today, -scheduledLimits.vectorDays),
      });
    case "hub": {
      const result = await ingestHub(
        db,
        http,
        { hub: deps.limiters.hub, arxiv: deps.limiters.arxiv },
        {
          now,
          today,
          token: deps.hfToken,
          // Discovery fetches trending lists and a large arXiv batch, which can pass the CPU limit.
          discover: false,
          retentionDays: scheduledLimits.retentionDays,
          refreshLimit: scheduledLimits.hubPapers,
          staleDays: 7,
        },
      );

      return { refreshed: result.refreshed, links: result.links };
    }

    case "github": {
      const result = await ingestGithub(db, http, {
        now,
        today,
        token: deps.githubToken,
        limit: scheduledLimits.githubRepos,
        staleDays: 7,
      });

      return { refreshed: result.refreshed, gone: result.gone, stoppedEarly: result.stoppedEarly };
    }

    case "pwc":
      return ingestConcepts(db, http, deps.limiters.pwc, {
        now,
        limit: scheduledLimits.pwcPapers,
        staleDays: 30,
        retryDays: 3,
      });
    case "maintain": {
      const expiredVectors = await expireEmbeddings(db, deps.index, {
        cutoff: addDays(today, -scheduledLimits.vectorDays),
        limit: scheduledLimits.expireVectors,
      });

      const pruned = await prunePapers(db, addDays(today, -scheduledLimits.retentionDays));

      await deps.index.delete(pruned);

      const { changes } = await db.run(
        sql("DELETE FROM ingest_runs WHERE started_at < ?", [
          addDays(today, -scheduledLimits.keepRunsDays),
        ]),
      );

      return { expiredVectors, prunedPapers: pruned.length, removedRuns: changes };
    }
  }
};

/**
 * Runs the next job and records the run in `ingest_runs`.
 *
 * Every job continues from stored state, so a run that stops at a limit continues on the next run of the same job.
 * A failed job is recorded and the error is thrown again, so that the Workers dashboard shows it.
 */
export const runScheduled = async (deps: ScheduledDependencies): Promise<ScheduledRun> => {
  const job = await nextJob(deps.db);
  const startedAt = deps.now().toISOString();
  let run: ScheduledRun;
  let failure: Error | null = null;

  try {
    run = { job, status: "ok", result: await runJob(job, deps), error: null };
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    run = { job, status: "error", result: null, error: failure.message };
  }

  await deps.db.run(
    sql(
      `INSERT INTO ingest_runs (job, started_at, finished_at, status, result, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        job,
        startedAt,
        deps.now().toISOString(),
        run.status,
        run.result === null ? null : JSON.stringify(run.result),
        run.error,
      ],
    ),
  );

  if (failure !== null) {
    throw failure;
  }

  return run;
};
