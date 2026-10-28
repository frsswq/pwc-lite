import { countPendingEmbeddings } from "../../ingest/embed";
import { type RankedHit, rankedSearch, searchModes } from "../../query/ranking";
import { parseCommandArgs, readChoice, readDate, readPositiveInt } from "../args";
import type { Command } from "../context";
import { readTag } from "./library";
import { formatSummary } from "../format";

const decimals = 5;

const formatRank = (rank: number | null) => (rank === null ? "-" : `#${rank}`);

/** One line that shows how the score of a hit is made, in the order of the sum. */
export const formatExplain = ({ score, parts }: RankedHit): string =>
  [
    `score ${score.toFixed(decimals)} =`,
    `keyword ${parts.keyword.toFixed(decimals)} (${formatRank(parts.keywordRank)})`,
    `+ semantic ${parts.semantic.toFixed(decimals)} (${formatRank(parts.semanticRank)})`,
    `+ recency ${parts.recency.toFixed(decimals)}`,
    `+ links ${parts.links.toFixed(decimals)}`,
    `+ popularity ${parts.popularity.toFixed(decimals)}`,
  ].join(" ");

export const searchCommand: Command = {
  name: "search",
  usage:
    "pwc search <query> [--mode keyword|semantic|hybrid] [--limit <n>] [--since <YYYY-MM-DD>] [--saved] [--tag <tag>] [--explain] [--json]",
  summary: "Search titles, abstracts, and authors by keywords and meaning",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, {
      mode: { type: "string" },
      limit: { type: "string" },
      since: { type: "string" },
      saved: { type: "boolean" },
      tag: { type: "string" },
      explain: { type: "boolean" },
      json: { type: "boolean" },
    });

    const query = positionals.join(" ");
    const mode = readChoice("mode", values.mode, searchModes, "hybrid");
    const index = context.openVectorIndex(db);

    const hits = await rankedSearch(
      db,
      { embedder: context.embedder, index },
      {
        query,
        mode,
        limit: readPositiveInt("limit", values.limit, 20),
        filter: {
          since: readDate("since", values.since),
          saved: values.saved === true,
          tag: values.tag === undefined ? null : readTag(values.tag),
          ingestedAfter: null,
        },
        now: context.now(),
      },
    );

    if (mode !== "keyword") {
      const pending = await countPendingEmbeddings(db, index.model);

      if (pending > 0) {
        context.stderr(
          `${pending} papers have no vector for ${index.model}. Run "pwc embed" to include them.`,
        );
      }
    }

    if (values.json) {
      context.stdout(JSON.stringify(hits, null, 2));

      return;
    }

    if (hits.length === 0) {
      context.stdout(`No papers match "${query}".`);

      return;
    }

    const indent = " ".repeat(12);

    context.stdout(
      hits
        .map((hit) =>
          values.explain
            ? `${formatSummary(hit)}\n${indent}${formatExplain(hit)}`
            : formatSummary(hit),
        )
        .join("\n\n"),
    );
  },
};
