-- Papers in the catalog, keyed by arXiv ID without version.
-- `pk` is an explicit rowid, so that VACUUM cannot renumber the rows that `papers_fts` refers to.
CREATE TABLE papers (
  pk INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  version INTEGER,
  title TEXT NOT NULL,
  abstract TEXT NOT NULL,
  author_names TEXT NOT NULL,
  published_at TEXT,
  updated_at TEXT,
  primary_category TEXT,
  categories TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories) AND json_type(categories) = 'array'),
  doi TEXT,
  added_via TEXT NOT NULL CHECK (added_via IN ('hf_daily', 'hf_hub', 'manual')),
  ingested_at TEXT NOT NULL,
  arxiv_fetched_at TEXT
) STRICT;
--> statement-breakpoint
CREATE INDEX papers_published_at ON papers (published_at);
--> statement-breakpoint
CREATE INDEX papers_ingested_at ON papers (ingested_at);
--> statement-breakpoint
CREATE TABLE authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE
) STRICT;
--> statement-breakpoint
CREATE TABLE paper_authors (
  paper_id TEXT NOT NULL REFERENCES papers (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  author_id INTEGER NOT NULL REFERENCES authors (id),
  PRIMARY KEY (paper_id, position)
) STRICT;
--> statement-breakpoint
CREATE INDEX paper_authors_author_id ON paper_authors (author_id);
--> statement-breakpoint
CREATE TABLE links (
  paper_id TEXT NOT NULL REFERENCES papers (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('github', 'hf_model', 'hf_dataset', 'hf_space', 'project_page')),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  popularity INTEGER,
  last_activity_at TEXT,
  fetched_at TEXT,
  PRIMARY KEY (paper_id, kind, external_id)
) STRICT;
--> statement-breakpoint
CREATE INDEX links_kind_external_id ON links (kind, external_id);
--> statement-breakpoint
CREATE TABLE signals (
  paper_id TEXT NOT NULL REFERENCES papers (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('hf_daily_upvotes')),
  observed_on TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (paper_id, source, observed_on)
) STRICT;
--> statement-breakpoint
CREATE INDEX signals_observed_on ON signals (observed_on);
--> statement-breakpoint
CREATE TABLE ingest_cursors (
  source TEXT PRIMARY KEY NOT NULL,
  cursor TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
--> statement-breakpoint
CREATE VIRTUAL TABLE papers_fts USING fts5 (
  title,
  abstract,
  author_names,
  content = 'papers',
  content_rowid = 'pk',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER papers_fts_after_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts (rowid, title, abstract, author_names)
  VALUES (new.pk, new.title, new.abstract, new.author_names);
END;
--> statement-breakpoint
CREATE TRIGGER papers_fts_after_delete AFTER DELETE ON papers BEGIN
  INSERT INTO papers_fts (papers_fts, rowid, title, abstract, author_names)
  VALUES ('delete', old.pk, old.title, old.abstract, old.author_names);
END;
--> statement-breakpoint
CREATE TRIGGER papers_fts_after_update AFTER UPDATE OF title, abstract, author_names ON papers BEGIN
  INSERT INTO papers_fts (papers_fts, rowid, title, abstract, author_names)
  VALUES ('delete', old.pk, old.title, old.abstract, old.author_names);
  INSERT INTO papers_fts (rowid, title, abstract, author_names)
  VALUES (new.pk, new.title, new.abstract, new.author_names);
END;
