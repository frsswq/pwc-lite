import type { Embedder } from "../embed/embedder";
import type { EmbeddingModel } from "../embed/models";
import type { AiBinding } from "./bindings";

/** Texts in one Workers AI embedding request. */
const maxBatch = 100;

/**
 * An Embedder on Workers AI.
 *
 * Workers AI uses mean pooling by default, so the request names the pooling of the local model.
 * CLS and mean vectors are not compatible.
 */
export const createWorkersAiEmbedder = (ai: AiBinding, model: EmbeddingModel): Embedder => {
  const { workersAiId } = model;

  if (workersAiId === null) {
    throw new Error(`${model.name} is not available in Workers AI`);
  }

  const embed = async (texts: readonly string[]): Promise<Float32Array[]> => {
    const vectors: Float32Array[] = [];

    for (let start = 0; start < texts.length; start += maxBatch) {
      const batch = texts.slice(start, start + maxBatch);
      const { data } = await ai.run(workersAiId, { text: batch, pooling: model.pooling });

      if (data.length !== batch.length) {
        throw new Error(`Workers AI returned ${data.length} vectors for ${batch.length} texts`);
      }

      for (const values of data) {
        if (values.length !== model.dimensions) {
          throw new Error(
            `Workers AI returned ${values.length} dimensions, not ${model.dimensions}`,
          );
        }

        vectors.push(Float32Array.from(values));
      }
    }

    return vectors;
  };

  return {
    model: model.name,
    embedDocuments: embed,
    embedQuery: async (text) => {
      const [vector] = await embed([model.queryPrefix + text]);

      if (vector === undefined) {
        throw new Error("Workers AI returned no vector for the query");
      }

      return vector;
    },
  };
};
