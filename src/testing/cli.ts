import type { CliContext, ListenOptions } from "../cli/context";
import { runCli } from "../cli/run";
import type { Database } from "../db/database";
import type { Embedder } from "../embed/embedder";
import { createRateLimiter } from "../sources/rate-limit";
import { createTableVectorIndex } from "../vectors/table-index";
import { keywordEmbedder } from "./embedder";
import type { FakeHttp } from "./fake-http";

export type CliRun = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type TestCliOptions = {
  readonly now?: string;
  readonly embedder?: Embedder;
  /** Receives each file that the command writes. */
  readonly files?: Map<string, string>;
  /** Receives the options of each server that the command starts. The server stops at once. */
  readonly listen?: (options: ListenOptions) => void;
};

/** Runs the CLI against a shared test database. The run does not close the database. */
export const runTestCli = async (
  db: Database,
  http: FakeHttp,
  argv: readonly string[],
  options: TestCliOptions = {},
): Promise<CliRun> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const embedder = options.embedder ?? keywordEmbedder(["diffusion", "attention", "robot"]);

  const context: CliContext = {
    config: {
      databasePath: ":memory:",
      hfToken: null,
      githubToken: null,
      embeddingModel: {
        name: embedder.model,
        huggingFaceId: "test/model",
        queryPrefix: "",
        pooling: "cls",
        dimensions: 4,
        workersAiId: null,
      },
      modelCacheDir: "/nonexistent",
    },
    openDatabase: async () => ({ ...db, close: async () => undefined }),
    http: http.client,
    arxivLimiter: createRateLimiter(3000, http.client.sleep, () => 0),
    hubLimiter: createRateLimiter(250, http.client.sleep, () => 0),
    pwcLimiter: createRateLimiter(1000, http.client.sleep, () => 0),
    embedder,
    openVectorIndex: (target) => createTableVectorIndex(target, embedder.model),
    writeFile: async (path, content) => {
      options.files?.set(path, content);
    },
    listen: (listenOptions) => {
      options.listen?.(listenOptions);

      return {
        url: `http://${listenOptions.hostname}:${listenOptions.port}/`,
        closed: Promise.resolve(),
      };
    },
    now: () => new Date(options.now ?? "2026-10-24T08:00:00.000Z"),
    stdout: (text) => void stdout.push(text),
    stderr: (text) => void stderr.push(text),
  };

  const code = await runCli(argv, context);

  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
};
