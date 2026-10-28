import { expect, test } from "bun:test";
import { join } from "node:path";

import { loadConfig } from "./config";

const defaultPath = join(import.meta.dir, "..", "data", "pwc.db");

test("uses data/pwc.db in the project by default", () => {
  expect(loadConfig({}).databasePath).toBe(defaultPath);
});

test("treats an empty PWC_DB_PATH as unset", () => {
  expect(loadConfig({ PWC_DB_PATH: "" }).databasePath).toBe(defaultPath);
});

test("reads PWC_DB_PATH", () => {
  expect(loadConfig({ PWC_DB_PATH: "/tmp/other.db" }).databasePath).toBe("/tmp/other.db");
});

test("reads tokens and treats empty values as unset", () => {
  expect(loadConfig({ PWC_HF_TOKEN: "hf_x" }).hfToken).toBe("hf_x");
  expect(loadConfig({ PWC_HF_TOKEN: "" }).hfToken).toBeNull();
  expect(loadConfig({ PWC_GITHUB_TOKEN: "gh_x" }).githubToken).toBe("gh_x");
  expect(loadConfig({}).githubToken).toBeNull();
});

test("uses the default embedding model and reads PWC_EMBED_MODEL", () => {
  expect(loadConfig({}).embeddingModel.name).toBe("bge-small-en-v1.5");
  expect(loadConfig({ PWC_EMBED_MODEL: "all-MiniLM-L6-v2" }).embeddingModel.name).toBe(
    "all-MiniLM-L6-v2",
  );
});

test("rejects an unknown embedding model", () => {
  expect(() => loadConfig({ PWC_EMBED_MODEL: "gpt-embed" })).toThrow(
    'PWC_EMBED_MODEL "gpt-embed" is not a known model',
  );
});
