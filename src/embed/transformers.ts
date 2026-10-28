import { type FeatureExtractionPipeline, env, pipeline } from "@huggingface/transformers";

import type { Embedder } from "./embedder";
import type { EmbeddingModel } from "./models";

/**
 * An Embedder that runs the model on the CPU with transformers.js.
 *
 * The model loads on the first call, so that commands that do not embed stay fast.
 * The first load downloads the model into `cacheDir`.
 */
export const createTransformersEmbedder = (model: EmbeddingModel, cacheDir: string): Embedder => {
  let loaded: Promise<FeatureExtractionPipeline> | null = null;

  const load = (): Promise<FeatureExtractionPipeline> => {
    env.cacheDir = cacheDir;
    loaded ??= pipeline("feature-extraction", model.huggingFaceId, { dtype: "fp32" });

    return loaded;
  };

  const embed = async (texts: readonly string[]): Promise<Float32Array[]> => {
    if (texts.length === 0) {
      return [];
    }

    const extract = await load();
    const tensor = await extract([...texts], { pooling: model.pooling, normalize: true });
    const [rows, dimensions] = tensor.dims;

    if (!(tensor.data instanceof Float32Array) || rows !== texts.length) {
      throw new Error(
        `${model.name} returned an unexpected tensor of shape ${tensor.dims.join("x")}`,
      );
    }

    if (dimensions !== model.dimensions) {
      throw new Error(`${model.name} returned ${dimensions} dimensions, not ${model.dimensions}`);
    }

    const data = tensor.data;

    return texts.map((_, row) => data.slice(row * dimensions, (row + 1) * dimensions));
  };

  return {
    model: model.name,
    embedDocuments: embed,
    embedQuery: async (text) => {
      const [vector] = await embed([model.queryPrefix + text]);

      if (vector === undefined) {
        throw new Error(`${model.name} returned no vector for the query`);
      }

      return vector;
    },
  };
};
