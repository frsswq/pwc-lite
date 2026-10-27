import { utcDate } from "../../domain/dates";
import { listRecentPapers } from "../../query/papers";
import { parseCommandArgs, readPositiveInt } from "../args";
import type { Command } from "../context";
import { formatSummaries } from "../format";

export const recentCommand: Command = {
  name: "recent",
  usage: "pwc recent [--days <n>] [--limit <n>] [--json]",
  summary: "List recently published papers, most upvoted first for each day",
  run: async (args, context, db) => {
    const { values } = parseCommandArgs(args, {
      days: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
    });

    const papers = await listRecentPapers(db, {
      days: readPositiveInt("days", values.days, 7),
      today: utcDate(context.now()),
      limit: readPositiveInt("limit", values.limit, 30),
    });

    context.stdout(
      values.json ? JSON.stringify(papers, null, 2) : formatSummaries(papers, "No recent papers."),
    );
  },
};
