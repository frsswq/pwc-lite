import { z } from "zod";

import { type Database, sql } from "../db/database";

/** Papers that prune may remove: older than the cutoff and with nothing that the user or a source attached. */
const prunable = `coalesce(published_at, ingested_at) < ?
  AND NOT EXISTS (SELECT 1 FROM links WHERE links.paper_id = papers.id)`;

const countRow = z.object({ count: z.number().int() });

export const countPrunable = async (db: Database, cutoff: string): Promise<number> =>
  (await db.first(
    sql(`SELECT count(*) AS count FROM papers WHERE ${prunable}`, [cutoff]),
    (row) => countRow.parse(row).count,
  )) ?? 0;

/** Removes prunable papers. Their signals go with them through ON DELETE CASCADE. */
export const prunePapers = async (db: Database, cutoff: string): Promise<number> =>
  (await db.run(sql(`DELETE FROM papers WHERE ${prunable}`, [cutoff]))).changes;
