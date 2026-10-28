import { join } from "node:path";

export type Config = {
  readonly databasePath: string;
  readonly hfToken: string | null;
  readonly githubToken: string | null;
};

export type Environment = Readonly<Record<string, string | undefined>>;

const defaultDatabasePath = join(import.meta.dir, "..", "data", "pwc.db");

/** Reads settings from environment variables, with defaults for unset or empty values. */
export const loadConfig = (env: Environment): Config => ({
  databasePath: env.PWC_DB_PATH || defaultDatabasePath,
  hfToken: env.PWC_HF_TOKEN || null,
  githubToken: env.PWC_GITHUB_TOKEN || null,
});
