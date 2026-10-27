import { parseArxivId } from "../../domain/arxiv-id";
import { getPaper } from "../../query/papers";
import { UsageError, onePositional, parseCommandArgs } from "../args";
import type { Command } from "../context";
import { formatDetail } from "../format";

export const showCommand: Command = {
  name: "show",
  usage: "pwc show <arxiv-id-or-url> [--json]",
  summary: "Show one paper with its links and upvotes",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, { json: { type: "boolean" } });
    const input = onePositional(positionals, "arXiv ID or URL");
    const parsed = parseArxivId(input);

    if (parsed === null) {
      throw new UsageError(`"${input}" is not an arXiv ID or URL`);
    }

    const detail = await getPaper(db, parsed.id);

    if (detail === null) {
      throw new Error(`${parsed.id} is not in the catalog. Run "pwc add ${parsed.id}" to add it.`);
    }

    context.stdout(values.json ? JSON.stringify(detail, null, 2) : formatDetail(detail));
  },
};
