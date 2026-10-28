import { type Statement, sql } from "../db/database";
import type { ArxivId } from "../domain/arxiv-id";

/** Saves a paper. A paper that is already saved keeps its first `saved_at`. */
export const savePaper = (id: ArxivId, now: string): Statement =>
  sql(
    `INSERT INTO library (paper_id, saved_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (paper_id) DO UPDATE SET saved_at = excluded.saved_at, updated_at = excluded.updated_at
     WHERE library.saved_at IS NULL`,
    [id, now, now],
  );

/** Unsaves a paper. A note keeps the library row. */
export const unsavePaper = (id: ArxivId, now: string): Statement[] => [
  sql("DELETE FROM library WHERE paper_id = ? AND saved_at IS NOT NULL AND note IS NULL", [id]),
  sql(
    "UPDATE library SET saved_at = NULL, updated_at = ? WHERE paper_id = ? AND saved_at IS NOT NULL",
    [now, id],
  ),
];

export const setNote = (id: ArxivId, note: string, now: string): Statement =>
  sql(
    `INSERT INTO library (paper_id, note, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (paper_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
     WHERE library.note IS NOT excluded.note`,
    [id, note, now],
  );

/** Removes the note. A saved paper keeps its library row. */
export const clearNote = (id: ArxivId, now: string): Statement[] => [
  sql("DELETE FROM library WHERE paper_id = ? AND note IS NOT NULL AND saved_at IS NULL", [id]),
  sql("UPDATE library SET note = NULL, updated_at = ? WHERE paper_id = ? AND note IS NOT NULL", [
    now,
    id,
  ]),
];

/** Adds tags to a paper. Tags that the paper already has do not change. */
export const tagPaper = (id: ArxivId, tags: readonly string[], now: string): Statement[] => {
  const names = JSON.stringify(tags);

  return [
    sql(
      "INSERT INTO tags (name) SELECT value FROM json_each(?) WHERE true ON CONFLICT (name) DO NOTHING",
      [names],
    ),
    sql(
      `INSERT INTO paper_tags (paper_id, tag_id, tagged_at)
       SELECT ?, id, ? FROM tags WHERE name IN (SELECT value FROM json_each(?))
       ON CONFLICT (paper_id, tag_id) DO NOTHING`,
      [id, now, names],
    ),
  ];
};

/** Removes tags from a paper, then removes tags that no paper has. */
export const untagPaper = (id: ArxivId, tags: readonly string[]): Statement[] => [
  sql(
    `DELETE FROM paper_tags WHERE paper_id = ?
     AND tag_id IN (SELECT id FROM tags WHERE name IN (SELECT value FROM json_each(?)))`,
    [id, JSON.stringify(tags)],
  ),
  sql("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM paper_tags)"),
];
