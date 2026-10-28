-- One row for each scheduled ingest run.
CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  -- JSON object with the job result, or null after an error.
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error TEXT
) STRICT;
--> statement-breakpoint
CREATE INDEX ingest_runs_started_at ON ingest_runs (started_at);
