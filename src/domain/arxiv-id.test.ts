import { describe, expect, test } from "bun:test";

import { parseArxivId } from "./arxiv-id";

describe("parseArxivId", () => {
  test.each([
    ["2610.31329", "2610.31329", null],
    ["2610.31329v2", "2610.31329", 2],
    ["1501.0001", "1501.0001", null],
    ["  arXiv:2610.31329v12 ", "2610.31329", 12],
    ["https://arxiv.org/abs/2610.31329v2", "2610.31329", 2],
    ["http://export.arxiv.org/abs/2610.31329", "2610.31329", null],
    ["https://arxiv.org/pdf/2610.31329v1", "2610.31329", 1],
    ["https://arxiv.org/pdf/2610.31329v1.pdf", "2610.31329", 1],
    ["https://arxiv.org/html/2610.31329v3/", "2610.31329", 3],
    ["https://huggingface.co/papers/2610.31329", "2610.31329", null],
    ["cs/0112017", "cs/0112017", null],
    ["cs/0112017v1", "cs/0112017", 1],
    ["math.GT/0309136", "math/0309136", null],
    ["hep-th/9901001v3", "hep-th/9901001", 3],
    ["https://arxiv.org/abs/math.GT/0309136v1", "math/0309136", 1],
  ])("parses %p", (input, id, version) => {
    const parsed = parseArxivId(input);

    expect(parsed === null ? null : { id: `${parsed.id}`, version: parsed.version }).toEqual({
      id,
      version,
    });
  });

  test.each([
    "",
    "2610.313",
    "2610.313299",
    "26100.31329",
    "2610.31329v",
    "cs/011201",
    "https://example.com/abs/2610.31329",
    "https://arxiv.org/list/cs.AI/recent",
    "not an id",
  ])("rejects %p", (input) => {
    expect(parseArxivId(input)).toBeNull();
  });
});
