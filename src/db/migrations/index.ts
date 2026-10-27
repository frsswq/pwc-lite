import type { Migration } from "../migrate";

/**
 * Every migration in apply order.
 *
 * Files are imported explicitly, so that a Worker bundle can include them without file system access.
 */
export const migrations: readonly Migration[] = [];
