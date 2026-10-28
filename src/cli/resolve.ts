import { z } from "zod";

import { type Database, sql } from "../db/database";
import { type ArxivId, parseArxivId } from "../domain/arxiv-id";
import { UsageError } from "./args";

const foundRow = z.object({ found: z.number().int() });

/** Reads an arXiv ID or URL from the command line. */
export const readArxivId = (input: string): ArxivId => {
  const parsed = parseArxivId(input);

  if (parsed === null) {
    throw new UsageError(`"${input}" is not an arXiv ID or URL`);
  }

  return parsed.id;
};

/** Reads an arXiv ID or URL and checks that the paper is in the catalog. */
export const readCatalogPaper = async (db: Database, input: string): Promise<ArxivId> => {
  const id = readArxivId(input);

  const row = await db.first(
    sql("SELECT count(*) AS found FROM papers WHERE id = ?", [id]),
    (value) => foundRow.parse(value).found,
  );

  if (row !== 1) {
    throw new Error(`${id} is not in the catalog. Run "pwc add ${id}" to add it.`);
  }

  return id;
};
