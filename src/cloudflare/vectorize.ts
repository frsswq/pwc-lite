import type { VectorIndex } from "../vectors/vector-index";
import type { VectorizeBinding } from "./bindings";

/** Vectorize limits from the Workers documentation. */
export const vectorizeLimits = { upsertBatch: 1000, deleteBatch: 1000, topK: 100 } as const;

const chunks = <Item>(items: readonly Item[], size: number): Item[][] => {
  const result: Item[][] = [];

  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }

  return result;
};

/**
 * A VectorIndex on a Vectorize index that uses the cosine metric.
 *
 * One Vectorize index holds one model. A query returns at most 100 matches, the Vectorize limit without values.
 * Vectorize applies writes some seconds after the call returns.
 */
export const createVectorizeIndex = (vectorize: VectorizeBinding, model: string): VectorIndex => ({
  model,
  upsert: async (entries) => {
    for (const batch of chunks(entries, vectorizeLimits.upsertBatch)) {
      await vectorize.upsert(batch.map(({ id, vector }) => ({ id, values: Array.from(vector) })));
    }
  },
  delete: async (ids) => {
    for (const batch of chunks(ids, vectorizeLimits.deleteBatch)) {
      await vectorize.deleteByIds(batch);
    }
  },
  query: async (vector, limit) => {
    const { matches } = await vectorize.query(Array.from(vector), {
      topK: Math.min(limit, vectorizeLimits.topK),
      returnValues: false,
      returnMetadata: "none",
    });

    return matches.map(({ id, score }) => ({ id, score }));
  },
});
