import { type Database, sql } from "../db/database";
import {
  type LibraryEntry,
  type PaperSummary,
  decodeEntry,
  decodeSummary,
  libraryColumns,
  summaryColumns,
} from "./papers";

export type LibraryItem = PaperSummary & { readonly library: LibraryEntry };

/** Lists saved, noted, and tagged papers, with the most recent library change first. */
export const listLibrary = async (
  db: Database,
  options: { readonly tag: string | null },
): Promise<LibraryItem[]> =>
  db.all(
    sql(
      `SELECT ${summaryColumns}, ${libraryColumns},
         max(coalesce(lib.updated_at, ''),
             coalesce((SELECT max(tagged_at) FROM paper_tags pt WHERE pt.paper_id = p.id), '')) AS changed_at
       FROM papers p LEFT JOIN library lib ON lib.paper_id = p.id
       WHERE (lib.paper_id IS NOT NULL OR EXISTS (SELECT 1 FROM paper_tags pt WHERE pt.paper_id = p.id))
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM paper_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.paper_id = p.id AND t.name = ?))
       ORDER BY changed_at DESC, p.id`,
      [options.tag, options.tag],
    ),
    (row) => ({ ...decodeSummary(row), library: decodeEntry(row) }),
  );
