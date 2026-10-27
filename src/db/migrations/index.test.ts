import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";

import { migrations } from "./index";

test("registers every SQL file in this directory in name order", () => {
  const files = readdirSync(import.meta.dir)
    .filter((file) => file.endsWith(".sql"))
    .toSorted();

  expect(migrations.map(({ name }) => `${name}.sql`)).toEqual(files);
});
