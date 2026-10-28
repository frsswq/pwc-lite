import { join } from "node:path";

import { exportForCloudflare, vectorCutoff } from "../../cloudflare/export";
import { utcDate } from "../../domain/dates";
import { UsageError, parseCommandArgs, readPositiveInt } from "../args";
import type { Command } from "../context";

/** Vectorize on the free plan stores about 13,000 vectors of 384 dimensions. See issue #17. */
export const cloudVectorDays = 270;

/** About 40% of the D1 free limit of 100,000 rows written each day, with room for FTS rows. */
const defaultRowsPerFile = 20_000;

export const exportCommand: Command = {
  name: "export",
  usage: "pwc export cloudflare --out <dir> [--vector-days <n>] [--rows-per-file <n>]",
  summary: "Write the catalog as files for D1 and Vectorize",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, {
      out: { type: "string" },
      "vector-days": { type: "string" },
      "rows-per-file": { type: "string" },
    });

    if (positionals.join(" ") !== "cloudflare") {
      throw new UsageError('Expected the target "cloudflare"');
    }

    if (values.out === undefined) {
      throw new UsageError("Expected --out <dir>");
    }

    const out = values.out;

    const files = await exportForCloudflare(db, {
      model: context.embedder.model,
      vectorsSince: vectorCutoff(
        utcDate(context.now()),
        readPositiveInt("vector-days", values["vector-days"], cloudVectorDays),
      ),
      rowsPerFile: readPositiveInt("rows-per-file", values["rows-per-file"], defaultRowsPerFile),
    });

    for (const file of files) {
      await context.writeFile(join(out, file.name), file.content);
    }

    const sqlFiles = files.flatMap(({ name }) => (name.endsWith(".sql") ? [name] : []));

    context.stdout(
      [
        `Wrote ${files.length} files to ${out}.`,
        "Run each SQL file on a separate day if the catalog is large:",
        ...sqlFiles.map(
          (name) => `  wrangler d1 execute pwc-lite --remote --file ${join(out, name)}`,
        ),
        "Then insert the vectors:",
        `  wrangler vectorize insert pwc-lite-bge-small --file ${join(out, "vectors.ndjson")}`,
      ].join("\n"),
    );
  },
};
