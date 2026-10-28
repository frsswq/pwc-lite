/** An embedding model that pwc-lite knows how to prompt and pool. */
export type EmbeddingModel = {
  /** The name that the catalog stores with each vector. */
  readonly name: string;
  /** The ONNX repository that transformers.js loads. */
  readonly huggingFaceId: string;
  /** Text that goes before a search query. Documents have no prefix. */
  readonly queryPrefix: string;
  readonly pooling: "cls" | "mean";
  readonly dimensions: number;
  /** The same model in Workers AI, or null when Workers AI does not have it. */
  readonly workersAiId: string | null;
};

const retrievalPrefix = "Represent this sentence for searching relevant passages: ";

export const embeddingModels = [
  {
    name: "bge-small-en-v1.5",
    huggingFaceId: "Xenova/bge-small-en-v1.5",
    queryPrefix: retrievalPrefix,
    pooling: "cls",
    dimensions: 384,
    workersAiId: "@cf/baai/bge-small-en-v1.5",
  },
  {
    name: "all-MiniLM-L6-v2",
    huggingFaceId: "Xenova/all-MiniLM-L6-v2",
    queryPrefix: "",
    pooling: "mean",
    dimensions: 384,
    workersAiId: null,
  },
  {
    name: "snowflake-arctic-embed-xs",
    huggingFaceId: "Snowflake/snowflake-arctic-embed-xs",
    queryPrefix: retrievalPrefix,
    pooling: "cls",
    dimensions: 384,
    workersAiId: null,
  },
] as const satisfies readonly EmbeddingModel[];

export type EmbeddingModelName = (typeof embeddingModels)[number]["name"];

export const defaultEmbeddingModel: EmbeddingModelName = "bge-small-en-v1.5";

export const findEmbeddingModel = (name: string): EmbeddingModel | null =>
  embeddingModels.find((model) => model.name === name) ?? null;
