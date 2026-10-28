-- Which papers have a current vector, and from which model.
-- The vectors themselves live behind the VectorIndex interface, which can be a table or an external index.
CREATE TABLE embeddings (
  paper_id TEXT PRIMARY KEY REFERENCES papers (id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  embedded_at TEXT NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX embeddings_model ON embeddings (model);
--> statement-breakpoint
-- A changed title or abstract makes the vector stale, so the next embed run replaces it.
CREATE TRIGGER papers_embedding_stale AFTER UPDATE OF title, abstract ON papers
WHEN old.title IS NOT new.title OR old.abstract IS NOT new.abstract
BEGIN
  DELETE FROM embeddings WHERE paper_id = new.id;
END;
--> statement-breakpoint
-- Storage for the local VectorIndex. Each vector is a little-endian float32 array.
CREATE TABLE vectors (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  vector BLOB NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX vectors_model ON vectors (model);
