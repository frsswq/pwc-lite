import {
  clearNote,
  savePaper,
  setNote,
  tagPaper,
  unsavePaper,
  untagPaper,
} from "../../catalog/library";
import { parseTag } from "../../domain/tag";
import { listLibrary } from "../../query/library";
import { UsageError, onePositional, parseCommandArgs } from "../args";
import type { Command } from "../context";
import { formatLibrary } from "../format";
import { readCatalogPaper } from "../resolve";

/** Reads a tag from the command line in its normal form. */
export const readTag = (text: string): string => {
  const tag = parseTag(text);

  if (tag === null) {
    throw new UsageError(
      `"${text}" is not a valid tag. Use letters, digits, ".", "_", and "-", with a letter or digit first`,
    );
  }

  return tag;
};

export const saveCommand: Command = {
  name: "save",
  usage: "pwc save <arxiv-id-or-url>",
  summary: "Save a paper to the library",
  run: async (args, context, db) => {
    const { positionals } = parseCommandArgs(args, {});
    const id = await readCatalogPaper(db, onePositional(positionals, "arXiv ID or URL"));
    const { changes } = await db.run(savePaper(id, context.now().toISOString()));

    context.stdout(changes === 0 ? `${id} is already saved.` : `Saved ${id}.`);
  },
};

export const unsaveCommand: Command = {
  name: "unsave",
  usage: "pwc unsave <arxiv-id-or-url>",
  summary: "Remove a paper from the saved papers. Its note and tags stay",
  run: async (args, context, db) => {
    const { positionals } = parseCommandArgs(args, {});
    const id = await readCatalogPaper(db, onePositional(positionals, "arXiv ID or URL"));
    const results = await db.batch(unsavePaper(id, context.now().toISOString()));
    const changes = results.reduce((sum, result) => sum + result.changes, 0);

    context.stdout(changes === 0 ? `${id} is not saved.` : `Unsaved ${id}.`);
  },
};

export const noteCommand: Command = {
  name: "note",
  usage: "pwc note <arxiv-id-or-url> <text...> | pwc note <arxiv-id-or-url> --clear",
  summary: "Set or clear the note of a paper",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, { clear: { type: "boolean" } });
    const [input, ...words] = positionals;
    const now = context.now().toISOString();

    if (input === undefined) {
      throw new UsageError("Expected an arXiv ID or URL");
    }

    const text = words.join(" ").trim();

    if (values.clear === true) {
      if (text !== "") {
        throw new UsageError("--clear takes no note text");
      }

      const id = await readCatalogPaper(db, input);

      await db.batch(clearNote(id, now));
      context.stdout(`Cleared the note of ${id}.`);

      return;
    }

    if (text === "") {
      throw new UsageError("Expected note text, or --clear to remove the note");
    }

    const id = await readCatalogPaper(db, input);

    await db.run(setNote(id, text, now));
    context.stdout(`Set the note of ${id}.`);
  },
};

export const tagCommand: Command = {
  name: "tag",
  usage: "pwc tag <arxiv-id-or-url> <tag...> [--remove]",
  summary: "Add tags to a paper, or remove them with --remove",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, { remove: { type: "boolean" } });
    const [input, ...names] = positionals;

    if (input === undefined || names.length === 0) {
      throw new UsageError("Expected an arXiv ID or URL and at least one tag");
    }

    const tags = [...new Set(names.map(readTag))];
    const id = await readCatalogPaper(db, input);

    if (values.remove === true) {
      await db.batch(untagPaper(id, tags));
      context.stdout(`Removed ${tags.join(", ")} from ${id}.`);

      return;
    }

    await db.batch(tagPaper(id, tags, context.now().toISOString()));
    context.stdout(`Tagged ${id} with ${tags.join(", ")}.`);
  },
};

export const libraryCommand: Command = {
  name: "library",
  usage: "pwc library [--tag <tag>] [--json]",
  summary: "List saved, noted, and tagged papers",
  run: async (args, context, db) => {
    const { values, positionals } = parseCommandArgs(args, {
      tag: { type: "string" },
      json: { type: "boolean" },
    });

    if (positionals.length > 0) {
      throw new UsageError("Expected no arguments");
    }

    const items = await listLibrary(db, {
      tag: values.tag === undefined ? null : readTag(values.tag),
    });

    context.stdout(values.json ? JSON.stringify(items, null, 2) : formatLibrary(items));
  },
};
