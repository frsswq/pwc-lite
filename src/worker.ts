import type { AiBinding, D1Binding, VectorizeBinding } from "./cloudflare/bindings";
import { createVectorizeIndex } from "./cloudflare/vectorize";
import { createWorkersAiEmbedder } from "./cloudflare/workers-ai";
import { createD1Database } from "./db/d1";
import { type EmbeddingModel, defaultEmbeddingModel, findEmbeddingModel } from "./embed/models";
import { type AppDependencies, createApp } from "./http/app";
import { hubIntervalMs } from "./ingest/hf-hub";
import { type ScheduledRun, runScheduled } from "./scheduled/scheduled";
import { arxivIntervalMs } from "./sources/arxiv";
import { type HttpClient, defaultHttpClient } from "./sources/http";
import { pwcIntervalMs } from "./sources/pwc";
import { createRateLimiter } from "./sources/rate-limit";

/** The bindings in `wrangler.jsonc`. */
export type WorkerEnv = {
  readonly DB: D1Binding;
  readonly VECTORIZE: VectorizeBinding;
  readonly AI: AiBinding;
  /** The embedding model of the Vectorize index. The default is the local default. */
  readonly EMBED_MODEL?: string;
  /** Secrets for higher rate limits. */
  readonly HF_TOKEN?: string;
  readonly GITHUB_TOKEN?: string;
};

/** Runs the next scheduled ingest job. Tests pass a fake HTTP client and clock. */
export const handleScheduled = async (
  env: WorkerEnv,
  http: HttpClient,
  now: () => Date,
): Promise<ScheduledRun> => {
  const deps = workerDependencies(env, now);

  return runScheduled({
    db: deps.db,
    http,
    embedder: deps.embedder,
    index: deps.index,
    limiters: {
      arxiv: createRateLimiter(arxivIntervalMs, http.sleep),
      hub: createRateLimiter(hubIntervalMs, http.sleep),
      pwc: createRateLimiter(pwcIntervalMs, http.sleep),
    },
    hfToken: env.HF_TOKEN || null,
    githubToken: env.GITHUB_TOKEN || null,
    now,
  });
};

const readModel = (env: WorkerEnv): EmbeddingModel => {
  const name = env.EMBED_MODEL ?? defaultEmbeddingModel;
  const model = findEmbeddingModel(name);

  if (model === null) {
    throw new Error(`EMBED_MODEL "${name}" is not a known model`);
  }

  return model;
};

/** Builds the query dependencies from the Worker bindings. */
export const workerDependencies = (env: WorkerEnv, now: () => Date): AppDependencies => {
  const model = readModel(env);

  return {
    db: createD1Database(env.DB),
    embedder: createWorkersAiEmbedder(env.AI, model),
    index: createVectorizeIndex(env.VECTORIZE, model.name),
    now,
  };
};

export default {
  fetch: async (request: Request, env: WorkerEnv): Promise<Response> =>
    createApp(workerDependencies(env, () => new Date())).fetch(request),
  scheduled: async (_controller: { readonly cron: string }, env: WorkerEnv): Promise<void> => {
    await handleScheduled(env, defaultHttpClient, () => new Date());
  },
};
