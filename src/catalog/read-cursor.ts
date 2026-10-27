import { z } from "zod";

import { type Database, type SqlRow, sql } from "../db/database";

const cursorRow = z.object({ cursor: z.string() });

const decodeCursor = (row: SqlRow): string => cursorRow.parse(row).cursor;

export const readCursor = async (db: Database, source: string): Promise<string | null> =>
  (await db.first(
    sql("SELECT cursor FROM ingest_cursors WHERE source = ?", [source]),
    decodeCursor,
  )) ?? null;
