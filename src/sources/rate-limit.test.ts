import { expect, test } from "bun:test";

import { createRateLimiter } from "./rate-limit";

test("waits only for the rest of the interval", async () => {
  let clock = 0;
  const sleeps: number[] = [];

  const limiter = createRateLimiter(
    3000,
    async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    () => clock,
  );

  await limiter.wait();
  clock += 1000;
  await limiter.wait();
  clock += 5000;
  await limiter.wait();

  expect(sleeps).toEqual([2000]);
});
