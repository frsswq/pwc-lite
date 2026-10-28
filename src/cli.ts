#!/usr/bin/env bun
import { runCli } from "./cli/run";
import { loadConfig } from "./config";
import { migrate } from "./db/migrate";
import { migrations } from "./db/migrations/index";
import { openSqliteDatabase } from "./db/sqlite";
import { createTransformersEmbedder } from "./embed/transformers";
import { arxivIntervalMs } from "./sources/arxiv";
import { defaultHttpClient } from "./sources/http";
import { createRateLimiter } from "./sources/rate-limit";
import { hubIntervalMs } from "./ingest/hf-hub";
import { createTableVectorIndex } from "./vectors/table-index";

const config = loadConfig(Bun.env);

const exitCode = await runCli(Bun.argv.slice(2), {
  config,
  openDatabase: async () => {
    const db = openSqliteDatabase(config.databasePath);

    await migrate(db, migrations);

    return db;
  },
  http: defaultHttpClient,
  arxivLimiter: createRateLimiter(arxivIntervalMs, defaultHttpClient.sleep),
  hubLimiter: createRateLimiter(hubIntervalMs, defaultHttpClient.sleep),
  embedder: createTransformersEmbedder(config.embeddingModel, config.modelCacheDir),
  openVectorIndex: (db) => createTableVectorIndex(db, config.embeddingModel.name),
  listen: (options) => {
    const server = Bun.serve(options);

    const closed = new Promise<void>((resolve) => {
      const stop = () => {
        void server.stop().then(resolve);
      };

      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });

    return { url: server.url.href, closed };
  },
  now: () => new Date(),
  stdout: (text) => {
    process.stdout.write(`${text}\n`);
  },
  stderr: (text) => {
    process.stderr.write(`${text}\n`);
  },
});

process.exitCode = exitCode;
