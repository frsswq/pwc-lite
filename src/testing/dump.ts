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

  const embeddings = await db.all(sql("SELECT * FROM embeddings ORDER BY paper_id"), keepRow);
  const library = await db.all(sql("SELECT * FROM library ORDER BY paper_id"), keepRow);
  const tags = await db.all(sql("SELECT * FROM tags ORDER BY id"), keepRow);

  const paperTags = await db.all(
    sql("SELECT * FROM paper_tags ORDER BY paper_id, tag_id"),
    keepRow,
  );

  return { papers, links, signals, cursors, embeddings, library, tags, paperTags };
};
