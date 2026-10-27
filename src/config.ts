import { join } from "node:path";

export type Config = {
  readonly databasePath: string;
};

export type Environment = Readonly<Record<string, string | undefined>>;

const defaultDatabasePath = join(import.meta.dir, "..", "data", "pwc.db");

/** Reads settings from environment variables, with defaults for unset or empty values. */
export const loadConfig = (env: Environment): Config => ({
  databasePath: env.PWC_DB_PATH || defaultDatabasePath,
});
