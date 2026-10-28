-- The personal library. A row exists while the paper is saved or has a note.
CREATE TABLE library (
  paper_id TEXT PRIMARY KEY REFERENCES papers (id) ON DELETE CASCADE,
  saved_at TEXT,
  note TEXT,
  updated_at TEXT NOT NULL,
  CHECK (saved_at IS NOT NULL OR note IS NOT NULL)
) STRICT;
--> statement-breakpoint
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;
--> statement-breakpoint
CREATE TABLE paper_tags (
  paper_id TEXT NOT NULL REFERENCES papers (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  tagged_at TEXT NOT NULL,
  PRIMARY KEY (paper_id, tag_id)
) STRICT;
--> statement-breakpoint
CREATE INDEX paper_tags_tag_id ON paper_tags (tag_id);
