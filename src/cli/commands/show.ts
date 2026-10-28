import { getPaper } from "../../query/papers";
import { onePositional, parseCommandArgs } from "../args";
import type { Command } from "../context";
import { formatDetail } from "../format";
import { readCatalogPaper } from "../resolve";

export const showCommand: Command = {
  name: "show",
  usage: "pwc show <arxiv-id-or-url> [--json]",
  summary: "Show one paper with its links, upvotes, and library entry",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, { json: { type: "boolean" } });
    const id = await readCatalogPaper(db, onePositional(positionals, "arXiv ID or URL"));
    const detail = await getPaper(db, id);

    if (detail === null) {
      throw new Error(`${id} is not in the catalog`);
    }

    context.stdout(values.json ? JSON.stringify(detail, null, 2) : formatDetail(detail));
  },
};
