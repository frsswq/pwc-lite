import { searchPapers } from "../../query/papers";
import { parseCommandArgs, readDate, readPositiveInt } from "../args";
import type { Command } from "../context";
import { formatSummaries } from "../format";

export const searchCommand: Command = {
  name: "search",
  usage: "pwc search <query> [--limit <n>] [--since <YYYY-MM-DD>] [--json]",
  summary: "Search titles, abstracts, and authors",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, {
      limit: { type: "string" },
      since: { type: "string" },
      json: { type: "boolean" },
    });

    const query = positionals.join(" ");

    const hits = await searchPapers(db, {
      query,
      limit: readPositiveInt("limit", values.limit, 20),
      since: readDate("since", values.since),
    });

    context.stdout(
      values.json
        ? JSON.stringify(hits, null, 2)
        : formatSummaries(hits, `No papers match "${query}".`),
    );
  },
};
