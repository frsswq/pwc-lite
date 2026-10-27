import { type ParseArgsConfig, parseArgs } from "node:util";
import { z } from "zod";

import { isIsoDate } from "../domain/dates";

/** Wrong command line input. The CLI prints the message with the command usage. */
export class UsageError extends Error {
  override readonly name = "UsageError";
}

type Options = NonNullable<ParseArgsConfig["options"]>;

export const parseCommandArgs = <Spec extends Options>(args: readonly string[], options: Spec) => {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
};

const positiveInt = z.coerce.number().int().positive();

export const readPositiveInt = (
  name: string,
  text: string | undefined,
  fallback: number,
): number => {
  if (text === undefined) {
    return fallback;
  }

  const result = positiveInt.safeParse(text);

  if (!result.success) {
    throw new UsageError(`--${name} must be a positive whole number, got "${text}"`);
  }

  return result.data;
};

export const readDate = (name: string, text: string | undefined): string | null => {
  if (text === undefined) {
    return null;
  }

  if (!isIsoDate(text)) {
    throw new UsageError(`--${name} must be a YYYY-MM-DD date, got "${text}"`);
  }

  return text;
};

export const onePositional = (positionals: readonly string[], label: string): string => {
  const [value, ...rest] = positionals;

  if (value === undefined || rest.length > 0) {
    throw new UsageError(`Expected exactly one ${label}`);
  }

  return value;
};
