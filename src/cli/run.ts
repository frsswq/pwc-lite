import { addCommand } from "./commands/add";
import { ingestCommand } from "./commands/ingest";
import { pruneCommand } from "./commands/prune";
import { recentCommand } from "./commands/recent";
import { searchCommand } from "./commands/search";
import { showCommand } from "./commands/show";
import { UsageError } from "./args";
import type { CliContext, Command } from "./context";

export const commands: readonly Command[] = [
  ingestCommand,
  addCommand,
  searchCommand,
  showCommand,
  recentCommand,
  pruneCommand,
];

const exitUsage = 2;
const exitFailure = 1;

export const helpText = (): string => {
  const width = Math.max(...commands.map(({ name }) => name.length));
  const lines = commands.map(({ name, summary }) => `  ${name.padEnd(width)}  ${summary}`);

  return `pwc - lightweight headless paper discovery

Usage:
  pwc <command> [options]

Commands:
${lines.join("\n")}

Run "pwc help <command>" for the options of a command.`;
};

const findCommand = (name: string | undefined) => commands.find((command) => command.name === name);

/** Runs one CLI invocation and returns its exit code. */
export const runCli = async (argv: readonly string[], context: CliContext): Promise<number> => {
  const [name, ...args] = argv;

  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    const topic = findCommand(args[0]);

    context.stdout(
      topic === undefined ? helpText() : `${topic.summary}\n\nUsage:\n  ${topic.usage}`,
    );

    return 0;
  }

  const command = findCommand(name);

  if (command === undefined) {
    context.stderr(`Unknown command "${name}".\n\n${helpText()}`);

    return exitUsage;
  }

  if (args.includes("--help") || args.includes("-h")) {
    context.stdout(`${command.summary}\n\nUsage:\n  ${command.usage}`);

    return 0;
  }

  const db = await context.openDatabase();

  try {
    await command.run(args, context, db);

    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      context.stderr(`${error.message}\n\nUsage:\n  ${command.usage}`);

      return exitUsage;
    }

    context.stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);

    return exitFailure;
  } finally {
    await db.close();
  }
};
