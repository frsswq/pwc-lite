-- When the Hugging Face Hub links of a paper were last fetched. Null means never.
ALTER TABLE papers ADD COLUMN hub_fetched_at TEXT;
--> statement-breakpoint
CREATE INDEX papers_hub_fetched_at ON papers (hub_fetched_at);
