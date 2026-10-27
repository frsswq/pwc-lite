import type { Sleep } from "./http";

export type RateLimiter = {
  /** Waits until the minimum interval since the previous call has passed. */
  readonly wait: () => Promise<void>;
};

/** Spaces calls at least `intervalMs` apart. The first call does not wait. */
export const createRateLimiter = (
  intervalMs: number,
  sleep: Sleep,
  now: () => number = Date.now,
): RateLimiter => {
  let last: number | null = null;

  return {
    wait: async () => {
      if (last !== null) {
        const remaining = last + intervalMs - now();

        if (remaining > 0) {
          await sleep(remaining);
        }
      }

      last = now();
    },
  };
};
