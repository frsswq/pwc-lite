import type { Database } from "../../db/database";
import { utcDate } from "../../domain/dates";
import { pendingArxivIds, storeArxivPapers } from "../../ingest/arxiv";
import { ingestDaily } from "../../ingest/hf-daily";
import { ingestGithub } from "../../ingest/github";
import { ingestHub } from "../../ingest/hf-hub";
import { UsageError, onePositional, parseCommandArgs, readDate, readPositiveInt } from "../args";
import type { CliContext, Command } from "../context";
import { defaultRetentionDays } from "./prune";

/** Upper bound of papers that one run sends to arXiv, about 30 seconds of requests. */
const arxivLimitPerRun = 500;

const options = {
  since: { type: "string" },
  lookback: { type: "string" },
  limit: { type: "string" },
  "stale-days": { type: "string" },
  "skip-arxiv": { type: "boolean" },
  "skip-discover": { type: "boolean" },
  json: { type: "boolean" },
} as const;

type IngestValues = ReturnType<typeof parseCommandArgs<typeof options>>["values"];

const runDaily = async (values: IngestValues, context: CliContext, db: Database) => {
  const now = context.now();

  const daily = await ingestDaily(db, context.http, {
    since: readDate("since", values.since),
    today: utcDate(now),
    lookbackDays: readPositiveInt("lookback", values.lookback, 7),
    token: context.config.hfToken,
    now: now.toISOString(),
  });

  context.stderr(
    `Daily Papers: ${daily.dates.length} dates, ${daily.papers} entries, ${daily.changes} rows changed.`,
  );

  if (daily.skippedIds.length > 0) {
    context.stderr(`Skipped entries without an arXiv ID: ${daily.skippedIds.join(", ")}`);
  }

  let arxiv = { stored: 0, missing: 0 };

  if (values["skip-arxiv"] !== true) {
    const pending = await pendingArxivIds(db, arxivLimitPerRun);

    if (pending.length > 0) {
      const result = await storeArxivPapers(
        db,
        context.http,
        context.arxivLimiter,
        pending,
        "hf_daily",
        now.toISOString(),
      );

      arxiv = { stored: result.stored.length, missing: result.missing.length };
      context.stderr(`arXiv metadata: ${arxiv.stored} stored, ${arxiv.missing} not available yet.`);
    }
  }

  return { daily, arxiv };
};

const runHub = async (values: IngestValues, context: CliContext, db: Database) => {
  const now = context.now();

  const hub = await ingestHub(
    db,
    context.http,
    { hub: context.hubLimiter, arxiv: context.arxivLimiter },
    {
      now: now.toISOString(),
      today: utcDate(now),
      token: context.config.hfToken,
      discover: values["skip-discover"] !== true,
      retentionDays: defaultRetentionDays,
      refreshLimit: readPositiveInt("limit", values.limit, 200),
      staleDays: readPositiveInt("stale-days", values["stale-days"], 7),
    },
  );

  context.stderr(
    `Hugging Face Hub: ${hub.discovered.length} papers discovered, ${hub.refreshed} papers refreshed, ${hub.links} links.`,
  );

  return { hub };
};

const runGithub = async (values: IngestValues, context: CliContext, db: Database) => {
  const now = context.now();

  const github = await ingestGithub(db, context.http, {
    now: now.toISOString(),
    today: utcDate(now),
    token: context.config.githubToken,
    limit: readPositiveInt("limit", values.limit, context.config.githubToken === null ? 50 : 1000),
    staleDays: readPositiveInt("stale-days", values["stale-days"], 7),
  });

  context.stderr(`GitHub: ${github.refreshed} repositories refreshed, ${github.gone.length} gone.`);

  if (github.stoppedEarly) {
    const reset =
      github.rateLimitResetAt === null ? "" : ` The limit resets at ${github.rateLimitResetAt}.`;

    context.stderr(
      `GitHub: stopped early to stay inside the rate limit.${reset} Set PWC_GITHUB_TOKEN for a higher limit.`,
    );
  }

  return { github };
};

/** Runs every source in dependency order: papers first, then their links. */
const runAll = async (values: IngestValues, context: CliContext, db: Database) => {
  if (values.limit !== undefined) {
    throw new UsageError(
      "--limit counts papers for hub and repositories for github, so ingest all does not accept it",
    );
  }

  return {
    ...(await runDaily(values, context, db)),
    ...(await runHub(values, context, db)),
    ...(await runGithub(values, context, db)),
  };
};

const sources = { daily: runDaily, hub: runHub, github: runGithub, all: runAll } as const;

const isSource = (name: string): name is keyof typeof sources => Object.hasOwn(sources, name);

export const ingestCommand: Command = {
  name: "ingest",
  usage: `pwc ingest daily [--since <YYYY-MM-DD>] [--lookback <days>] [--skip-arxiv] [--json]
  pwc ingest hub [--limit <papers>] [--stale-days <n>] [--skip-discover] [--json]
  pwc ingest github [--limit <repositories>] [--stale-days <n>] [--json]
  pwc ingest all [--since <YYYY-MM-DD>] [--skip-discover] [--json]`,
  summary: "Fetch papers and links from a source",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, options);
    const source = onePositional(positionals, "source");

    if (!isSource(source)) {
      throw new UsageError(
        `Unknown ingest source "${source}". Use one of: ${Object.keys(sources).join(", ")}.`,
      );
    }

    const report = await sources[source](values, context, db);

    if (values.json === true) {
      context.stdout(JSON.stringify(report, null, 2));
    }
  },
};
