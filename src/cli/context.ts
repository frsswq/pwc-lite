import type { Config } from "../config";
import type { Database } from "../db/database";
import type { HttpClient } from "../sources/http";
import type { RateLimiter } from "../sources/rate-limit";

export type CliContext = {
  readonly config: Config;
  /** Opens the catalog with every migration applied. */
  readonly openDatabase: () => Promise<Database>;
  readonly http: HttpClient;
  readonly arxivLimiter: RateLimiter;
  readonly now: () => Date;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
};

export type Command = {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly run: (args: readonly string[], context: CliContext, db: Database) => Promise<void>;
};
