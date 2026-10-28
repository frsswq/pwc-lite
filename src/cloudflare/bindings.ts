/**
 * The parts of the Cloudflare binding APIs that pwc-lite uses.
 *
 * These are structural types, so that a test can pass a fake and the code does not need the global Workers types.
 */

/** A value that D1 returns in a column. D1 returns a BLOB as an array of bytes. */
export type D1Value = string | number | null | number[];

export type D1Row = Readonly<Record<string, D1Value>>;

export type D1Result = {
  readonly results: readonly D1Row[];
  readonly meta: { readonly changes: number };
};

export type D1PreparedStatement = {
  readonly bind: (
    ...values: readonly (string | number | null | ArrayBuffer)[]
  ) => D1PreparedStatement;
  readonly all: () => Promise<D1Result>;
  readonly run: () => Promise<D1Result>;
};

export type D1Binding = {
  readonly prepare: (query: string) => D1PreparedStatement;
  readonly batch: (statements: readonly D1PreparedStatement[]) => Promise<D1Result[]>;
};

export type VectorizeMatch = { readonly id: string; readonly score: number };

/** Vectorize applies writes in the background and returns an ID for the change. */
export type VectorizeMutation = { readonly mutationId: string };

export type VectorizeBinding = {
  readonly upsert: (
    vectors: readonly { readonly id: string; readonly values: readonly number[] }[],
  ) => Promise<VectorizeMutation>;
  readonly deleteByIds: (ids: readonly string[]) => Promise<VectorizeMutation>;
  readonly query: (
    vector: readonly number[],
    options: {
      readonly topK: number;
      readonly returnValues: false;
      readonly returnMetadata: "none";
    },
  ) => Promise<{ readonly matches: readonly VectorizeMatch[] }>;
};

export type AiEmbeddingOutput = { readonly data: readonly (readonly number[])[] };

export type AiBinding = {
  readonly run: (
    model: string,
    input: { readonly text: readonly string[]; readonly pooling: "cls" | "mean" },
  ) => Promise<AiEmbeddingOutput>;
};
