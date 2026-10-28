import { z } from "zod";

import { addWatch, isWatchQuery, listWatches, removeWatch, runWatches } from "../../watch/watches";
import { UsageError, onePositional, parseCommandArgs, readPositiveInt } from "../args";
import type { Command } from "../context";
import { formatSummaries } from "../format";

const dayMs = 24 * 60 * 60 * 1000;

const watchId = z.coerce.number().int().positive();

const usage = `pwc watch [--limit <n>] [--dry-run] [--json]
  pwc watch add <query> [--days <n>]
  pwc watch list [--json]
  pwc watch rm <id>`;

export const watchCommand: Command = {
  name: "watch",
  usage,
  summary: "Follow topics and show their new papers",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, {
      limit: { type: "string" },
      days: { type: "string" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
    });

    const [action, ...rest] = positionals;

    if (action === "add") {
      const query = rest.join(" ").trim();

      if (!isWatchQuery(query)) {
        throw new UsageError("Expected a query with at least one word");
      }

      const now = context.now();
      const days = readPositiveInt("days", values.days, 7);

      const watch = await addWatch(db, query, {
        now: now.toISOString(),
        lastSeenAt: new Date(now.getTime() - days * dayMs).toISOString(),
      });

      if (watch === null) {
        throw new Error(`"${query}" is already watched`);
      }

      context.stdout(
        `Added watch ${watch.id} for "${query}". The first run shows papers ingested in the last ${days} days.`,
      );

      return;
    }

    if (action === "list") {
      const watches = await listWatches(db);

      if (values.json) {
        context.stdout(JSON.stringify(watches, null, 2));
      } else if (watches.length === 0) {
        context.stdout("No watches.");
      } else {
        context.stdout(
          watches
            .map(
              ({ id, query, lastSeenAt }) =>
                `${String(id).padStart(3)}  ${query}  (seen to ${lastSeenAt})`,
            )
            .join("\n"),
        );
      }

      return;
    }

    if (action === "rm") {
      const parsed = watchId.safeParse(onePositional(rest, "watch ID"));

      if (!parsed.success) {
        throw new UsageError("Expected a watch ID from pwc watch list");
      }

      if (!(await removeWatch(db, parsed.data))) {
        throw new Error(`There is no watch ${parsed.data}`);
      }

      context.stdout(`Removed watch ${parsed.data}.`);

      return;
    }

    if (action !== undefined) {
      throw new UsageError(`Unknown watch action "${action}"`);
    }

    const results = await runWatches(db, {
      limit: readPositiveInt("limit", values.limit, 20),
      dryRun: values["dry-run"] === true,
    });

    if (values.json) {
      context.stdout(JSON.stringify(results, null, 2));

      return;
    }

    context.stdout(
      results.length === 0
        ? 'No watches. Add one with pwc watch add "<query>".'
        : results
            .map(
              ({ watch, papers }) =>
                `== ${watch.id}: ${watch.query} (${papers.length} new)\n\n${formatSummaries(papers, "No new papers.")}`,
            )
            .join("\n\n"),
    );
  },
};
