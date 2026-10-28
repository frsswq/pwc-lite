import { embedPapers } from "../../ingest/embed";
import { parseCommandArgs, readPositiveInt } from "../args";
import type { Command } from "../context";

const batchSize = 16;

export const embedCommand: Command = {
  name: "embed",
  usage: "pwc embed [--limit <papers>] [--json]",
  summary: "Embed papers that have no vector for the current model",
  run: async (args, context, db) => {
    const { values } = parseCommandArgs(args, {
      limit: { type: "string" },
      json: { type: "boolean" },
    });

    const result = await embedPapers(db, context.embedder, context.openVectorIndex(db), {
      now: context.now().toISOString(),
      limit: readPositiveInt("limit", values.limit, 100_000),
      batchSize,
    });

    context.stdout(
      values.json
        ? JSON.stringify({ model: context.embedder.model, ...result }, null, 2)
        : `Embedded ${result.embedded} papers with ${context.embedder.model}. ${result.remaining} papers have no current vector.`,
    );
  },
};
