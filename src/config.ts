import { join } from "node:path";

import {
  type EmbeddingModel,
  defaultEmbeddingModel,
  embeddingModels,
  findEmbeddingModel,
} from "./embed/models";

export type Config = {
  readonly databasePath: string;
  readonly hfToken: string | null;
  readonly githubToken: string | null;
  readonly embeddingModel: EmbeddingModel;
  /** Directory for downloaded model files. */
  readonly modelCacheDir: string;
};

export type Environment = Readonly<Record<string, string | undefined>>;

const dataDir = join(import.meta.dir, "..", "data");

const readEmbeddingModel = (name: string): EmbeddingModel => {
  const model = findEmbeddingModel(name);

  if (model === null) {
    const known = embeddingModels.map((entry) => entry.name).join(", ");

    throw new Error(`PWC_EMBED_MODEL "${name}" is not a known model. Use one of: ${known}`);
  }

  return model;
};

/** Reads settings from environment variables, with defaults for unset or empty values. */
export const loadConfig = (env: Environment): Config => ({
  databasePath: env.PWC_DB_PATH || join(dataDir, "pwc.db"),
  hfToken: env.PWC_HF_TOKEN || null,
  githubToken: env.PWC_GITHUB_TOKEN || null,
  embeddingModel: readEmbeddingModel(env.PWC_EMBED_MODEL || defaultEmbeddingModel),
  modelCacheDir: env.PWC_MODEL_CACHE_DIR || join(dataDir, "models"),
});
