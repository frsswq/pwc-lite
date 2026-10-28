import { createApp } from "../../http/app";
import { parseCommandArgs, readPositiveInt } from "../args";
import type { Command } from "../context";

/** The API is for local tools only, so it never listens on other interfaces. */
const hostname = "127.0.0.1";

export const serveCommand: Command = {
  name: "serve",
  usage: "pwc serve [--port <n>]",
  summary: "Serve the JSON API on 127.0.0.1",
  run: async (args, context, db) => {
    const { values } = parseCommandArgs(args, { port: { type: "string" } });

    const app = createApp({
      db,
      embedder: context.embedder,
      index: context.openVectorIndex(db),
      now: context.now,
    });

    const server = context.listen({
      hostname,
      port: readPositiveInt("port", values.port, 8787),
      fetch: app.fetch,
    });

    context.stderr(`Listening on ${server.url}`);

    await server.closed;
  },
};
