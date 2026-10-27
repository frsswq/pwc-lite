import type { Database, SqlRow } from "../db/database";
import { sql } from "../db/database";

const keepRow = (row: SqlRow) => row;

/** Reads every catalog row, so tests can compare database states. */
export const dumpCatalog = async (db: Database) => {
  const papers = await db.all(sql("SELECT * FROM papers ORDER BY id"), keepRow);

  const links = await db.all(
    sql("SELECT * FROM links ORDER BY paper_id, kind, external_id"),
    keepRow,
  );

  const signals = await db.all(
    sql("SELECT * FROM signals ORDER BY paper_id, source, observed_on"),
    keepRow,
  );

  const cursors = await db.all(sql("SELECT * FROM ingest_cursors ORDER BY source"), keepRow);

  return { papers, links, signals, cursors };
};
