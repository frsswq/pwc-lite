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
