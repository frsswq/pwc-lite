import type { Migration } from "../migrate";
import initial from "./0001_initial.sql" with { type: "text" };

/**
 * Every migration in apply order.
 *
 * Files are imported explicitly, so that a Worker bundle can include them without file system access.
 */
export const migrations: readonly Migration[] = [{ name: "0001_initial", text: initial }];
