import type { Embedder } from "../embed/embedder";

/**
 * An Embedder with fixed vectors: one dimension for each keyword, plus one constant dimension.
 *
 * The value of a keyword dimension is how often the keyword occurs in the text.
 * The constant dimension keeps every vector nonzero.
 */
export const keywordEmbedder = (
  keywords: readonly string[],
  model = "test-model",
): Embedder & { readonly calls: string[][] } => {
  const calls: string[][] = [];

  const embedOne = (text: string): Float32Array => {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

    return Float32Array.from([
      ...keywords.map((keyword) => words.filter((word) => word === keyword).length),
      0.1,
    ]);
  };

  return {
    model,
    calls,
    embedDocuments: async (texts) => {
      calls.push([...texts]);

      return texts.map(embedOne);
    },
    embedQuery: async (text) => embedOne(text),
  };
};
