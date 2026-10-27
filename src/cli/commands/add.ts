import { parseArxivId } from "../../domain/arxiv-id";
import { storeArxivPapers } from "../../ingest/arxiv";
import { UsageError, parseCommandArgs } from "../args";
import type { Command } from "../context";

export const addCommand: Command = {
  name: "add",
  usage: "pwc add <arxiv-id-or-url>...",
  summary: "Add papers from arXiv, or refresh their arXiv metadata",
  run: async (args, context, db) => {
    const { positionals } = parseCommandArgs(args, {});

    if (positionals.length === 0) {
      throw new UsageError("Expected at least one arXiv ID or URL");
    }

    const ids = positionals.map((input) => {
      const parsed = parseArxivId(input);

      if (parsed === null) {
        throw new UsageError(`"${input}" is not an arXiv ID or URL`);
      }

      return parsed.id;
    });

    const result = await storeArxivPapers(
      db,
      context.http,
      context.arxivLimiter,
      ids,
      "manual",
      context.now().toISOString(),
    );

    for (const id of result.stored) {
      context.stdout(`Added ${id}`);
    }

    if (result.missing.length > 0) {
      throw new Error(`arXiv has no paper for ${result.missing.join(", ")}`);
    }
  },
};
