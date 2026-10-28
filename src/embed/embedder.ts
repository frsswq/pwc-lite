/** Turns text into vectors. Documents and queries can use different prompts for the same model. */
export type Embedder = {
  /** The model name that the catalog stores with each vector. */
  readonly model: string;
  readonly embedDocuments: (texts: readonly string[]) => Promise<Float32Array[]>;
  readonly embedQuery: (text: string) => Promise<Float32Array>;
};

/** The text that represents a paper for embedding. */
export const paperText = (paper: { readonly title: string; readonly abstract: string }): string =>
  `${paper.title}\n\n${paper.abstract}`;
