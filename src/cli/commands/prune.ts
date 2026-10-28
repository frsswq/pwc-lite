import { countPrunable, prunePapers } from "../../catalog/prune";
import { addDays, utcDate } from "../../domain/dates";
import { parseCommandArgs, readPositiveInt } from "../args";
import type { Command } from "../context";

export const defaultRetentionDays = 365;

export const pruneCommand: Command = {
  name: "prune",
  usage: "pwc prune [--days <n>] [--dry-run]",
  summary: "Remove old papers that have no links and are not in the library",
  run: async (args, context, db) => {
    const { values } = parseCommandArgs(args, {
      days: { type: "string" },
      "dry-run": { type: "boolean" },
    });

    const days = readPositiveInt("days", values.days, defaultRetentionDays);
    const cutoff = addDays(utcDate(context.now()), -days);

    if (values["dry-run"] === true) {
      context.stdout(
        `Would remove ${await countPrunable(db, cutoff)} papers published before ${cutoff}.`,
      );

      return;
    }

    const removed = await prunePapers(db, cutoff);

    await context.openVectorIndex(db).delete(removed);
    context.stdout(`Removed ${removed.length} papers published before ${cutoff}.`);
  },
};
