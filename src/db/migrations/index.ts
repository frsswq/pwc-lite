import type { Migration } from "../migrate";
import initial from "./0001_initial.sql" with { type: "text" };
import hubFetchedAt from "./0002_hub_fetched_at.sql" with { type: "text" };
import embeddings from "./0003_embeddings.sql" with { type: "text" };
import library from "./0004_library.sql" with { type: "text" };

/**
 * Every migration in apply order.
 *
 * Files are imported explicitly, so that a Worker bundle can include them without file system access.
 */
export const migrations: readonly Migration[] = [
  { name: "0001_initial", text: initial },
  { name: "0002_hub_fetched_at", text: hubFetchedAt },
  { name: "0003_embeddings", text: embeddings },
  { name: "0004_library", text: library },
];
