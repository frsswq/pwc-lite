import type { Config } from "../config";
import type { Database } from "../db/database";
import type { Embedder } from "../embed/embedder";
import type { HttpClient } from "../sources/http";
import type { RateLimiter } from "../sources/rate-limit";
import type { VectorIndex } from "../vectors/vector-index";

export type ListenOptions = {
  readonly hostname: string;
  readonly port: number;
  readonly fetch: (request: Request) => Response | Promise<Response>;
};

export type Listener = {
  readonly url: string;
  /** Resolves when the server stops, for example after an interrupt signal. */
  readonly closed: Promise<void>;
};

export type CliContext = {
  readonly config: Config;
  /** Opens the catalog with every migration applied. */
  readonly openDatabase: () => Promise<Database>;
  readonly http: HttpClient;
  readonly arxivLimiter: RateLimiter;
  readonly hubLimiter: RateLimiter;
  readonly pwcLimiter: RateLimiter;
  readonly embedder: Embedder;
  /** The vector index for the model of `embedder`. */
  readonly openVectorIndex: (db: Database) => VectorIndex;
  /** Starts an HTTP server. */
  readonly listen: (options: ListenOptions) => Listener;
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
