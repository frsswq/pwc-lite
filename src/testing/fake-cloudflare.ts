import type { AiBinding, VectorizeBinding } from "../cloudflare/bindings";
import type { Embedder } from "../embed/embedder";
import { dot, normalize } from "../vectors/vector-index";

/** An in-memory Vectorize index with the cosine metric. Writes apply at once. */
export const fakeVectorize = (): VectorizeBinding & {
  readonly vectors: Map<string, Float32Array>;
} => {
  const vectors = new Map<string, Float32Array>();
  let mutations = 0;

  const mutation = () => {
    mutations += 1;

    return { mutationId: String(mutations) };
  };

  return {
    vectors,
    upsert: async (entries) => {
      for (const { id, values } of entries) {
        vectors.set(id, normalize(Float32Array.from(values)));
      }

      return mutation();
    },
    deleteByIds: async (ids) => {
      for (const id of ids) {
        vectors.delete(id);
      }

      return mutation();
    },
    query: async (vector, options) => {
      if (options.topK > 100) {
        throw new Error("VECTOR_QUERY_ERROR: topK is too large");
      }

      const target = normalize(Float32Array.from(vector));

      const matches = [...vectors.entries()].map(([id, values]) => ({
        id,
        score: dot(values, target),
      }));

      return {
        matches: matches
          .toSorted((left, right) => right.score - left.score || left.id.localeCompare(right.id))
          .slice(0, options.topK),
      };
    },
  };
};

/** Adds zeros to a vector up to `dimensions`. Zeros do not change cosine similarity. */
export const padVector = (values: readonly number[], dimensions: number): number[] => [
  ...values,
  ...Array.from({ length: Math.max(0, dimensions - values.length) }, () => 0),
];

/** A Workers AI binding that answers embedding requests with a test Embedder, padded to `dimensions`. */
export const fakeAi = (
  embedder: Embedder,
  dimensions: number,
): AiBinding & { readonly calls: string[] } => {
  const calls: string[] = [];

  return {
    calls,
    run: async (model, input) => {
      calls.push(`${model} ${input.pooling} ${input.text.length}`);

      const vectors = await embedder.embedDocuments(input.text);

      return { data: vectors.map((vector) => padVector(Array.from(vector), dimensions)) };
    },
  };
};
