export type VectorEntry = {
  readonly id: string;
  readonly vector: Float32Array;
};

export type VectorMatch = {
  readonly id: string;
  /** Cosine similarity. Higher is better. */
  readonly score: number;
};

/**
 * The only vector storage contract outside `src/vectors/`.
 *
 * One index holds vectors of one model, so that every vector in a query has the same meaning.
 */
export type VectorIndex = {
  readonly model: string;
  /** Adds the entries, or replaces the vector of an entry whose ID is already in the index. */
  readonly upsert: (entries: readonly VectorEntry[]) => Promise<void>;
  /** Removes the entries. IDs that are not in the index have no effect. */
  readonly delete: (ids: readonly string[]) => Promise<void>;
  /** Returns at most `limit` entries, most similar first. */
  readonly query: (vector: Float32Array, limit: number) => Promise<VectorMatch[]>;
};

/** Scales a vector to length 1, so that a dot product gives the cosine similarity. */
export const normalize = (vector: Float32Array): Float32Array => {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  const length = Math.sqrt(sum);

  if (length === 0) {
    throw new Error("Cannot normalize a zero vector");
  }

  return vector.map((value) => value / length);
};

export const dot = (left: Float32Array, right: Float32Array): number => {
  if (left.length !== right.length) {
    throw new Error(`Vector lengths differ: ${left.length} and ${right.length}`);
  }

  let sum = 0;

  for (const [index, value] of left.entries()) {
    sum += value * (right[index] ?? 0);
  }

  return sum;
};
