-- Research tasks and methods from Papers with Code.
CREATE TABLE concepts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'method')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (kind, slug)
) STRICT;
--> statement-breakpoint
CREATE TABLE paper_concepts (
  paper_id TEXT NOT NULL REFERENCES papers (id) ON DELETE CASCADE,
  concept_id INTEGER NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, concept_id)
) STRICT;
--> statement-breakpoint
CREATE INDEX paper_concepts_concept_id ON paper_concepts (concept_id);
--> statement-breakpoint
-- When each paper was last looked up, and whether Papers with Code knew it.
CREATE TABLE concept_fetches (
  paper_id TEXT PRIMARY KEY REFERENCES papers (id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  found INTEGER NOT NULL CHECK (found IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE INDEX concept_fetches_fetched_at ON concept_fetches (fetched_at);
