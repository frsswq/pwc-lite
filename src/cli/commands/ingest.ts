import { utcDate } from "../../domain/dates";
import { pendingArxivIds, storeArxivPapers } from "../../ingest/arxiv";
import { ingestDaily } from "../../ingest/hf-daily";
import { UsageError, onePositional, parseCommandArgs, readDate, readPositiveInt } from "../args";
import type { Command } from "../context";

/** Upper bound of papers that one run sends to arXiv, about 30 seconds of requests. */
const arxivLimitPerRun = 500;

export const ingestCommand: Command = {
  name: "ingest",
  usage: "pwc ingest daily [--since <YYYY-MM-DD>] [--lookback <days>] [--skip-arxiv] [--json]",
  summary: "Fetch Hugging Face Daily Papers, then arXiv metadata for new papers",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, {
      since: { type: "string" },
      lookback: { type: "string" },
      "skip-arxiv": { type: "boolean" },
      json: { type: "boolean" },
    });

    const source = onePositional(positionals, "source");

    if (source !== "daily") {
      throw new UsageError(`Unknown ingest source "${source}". The available source is "daily".`);
    }

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
        context.stderr(
          `arXiv metadata: ${arxiv.stored} stored, ${arxiv.missing} not available yet.`,
        );
      }
    }

    if (values.json) {
      context.stdout(JSON.stringify({ daily, arxiv }, null, 2));
    }
  },
};
