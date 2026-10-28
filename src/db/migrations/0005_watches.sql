-- Topics that the user follows. A watch shows papers ingested after its last_seen_at.
CREATE TABLE watches (
  id INTEGER PRIMARY KEY,
  query TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
) STRICT;
