import type { CliContext } from "../cli/context";
import { runCli } from "../cli/run";
import type { Database } from "../db/database";
import { createRateLimiter } from "../sources/rate-limit";
import type { FakeHttp } from "./fake-http";

export type CliRun = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs the CLI against a shared test database. The run does not close the database. */
export const runTestCli = async (
  db: Database,
  http: FakeHttp,
  argv: readonly string[],
  now = "2026-10-24T08:00:00.000Z",
): Promise<CliRun> => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const context: CliContext = {
    config: { databasePath: ":memory:", hfToken: null, githubToken: null },
    openDatabase: async () => ({ ...db, close: async () => undefined }),
    http: http.client,
    arxivLimiter: createRateLimiter(3000, http.client.sleep, () => 0),
    hubLimiter: createRateLimiter(250, http.client.sleep, () => 0),
    now: () => new Date(now),
    stdout: (text) => void stdout.push(text),
    stderr: (text) => void stderr.push(text),
  };

  const code = await runCli(argv, context);

  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
};
