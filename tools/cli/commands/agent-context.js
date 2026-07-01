import { LINT_RULES } from "../../core/lint-rules.js";
import { FORMAT_NAMES } from "../../format/index.js";
import { CODES } from "../errors.js";
import { readPackageVersion } from "../pkg.js";
import { NO_MODULE_COMMANDS } from "./_no-module.js";
import { COMMANDS } from "./_registry.js";

export const describe = "Print a machine-readable schema (commands, flags, exit codes) as JSON.";

const SCHEMA_VERSION = 3;

const GLOBAL_FLAGS = [
  {
    name: "json",
    type: "boolean",
    description: "Shorthand for --format=json. Errors also emit JSON on stderr.",
  },
  {
    name: "format",
    short: "f",
    type: "string",
    enum: FORMAT_NAMES,
    description:
      "Output format. Per-command default below; html is render-only; json works for every module command.",
  },
  {
    name: "output",
    short: "o",
    type: "string",
    description: "Write to file instead of stdout.",
  },
  { name: "pretty", type: "boolean", description: "Pretty-print HTML/JSON output." },
  {
    name: "module",
    type: "string",
    description: "Alternative to first-positional module path.",
  },
  { name: "help", short: "h", type: "boolean", description: "Show help." },
];

const EXIT_CODES = [
  { code: 0, meaning: "success" },
  { code: 1, meaning: "usage error (bad args, missing module, bad module shape)" },
  { code: 2, meaning: "lint findings at error level (lint command)" },
  { code: 3, meaning: "render crash (render command)" },
  { code: 4, meaning: "test failures (test command)" },
];

const COMMAND_FLAGS = {
  list: [
    {
      name: "limit",
      type: "string",
      description:
        "Cap number of components emitted (0 = all). Truncated output is signaled by `truncated: true` in JSON.",
    },
  ],
  examples: [
    {
      name: "limit",
      type: "string",
      description: "Cap total number of example items emitted (0 = all).",
    },
  ],
  render: [
    { name: "title", type: "string", description: "Filter by example title." },
    { name: "view", type: "string", description: "Override example's view name." },
  ],
  test: [
    {
      name: "grep",
      type: "string",
      description: "Substring match against the full test path.",
    },
    {
      name: "bail",
      type: "boolean",
      description: "Stop on first failure; remaining tests reported as skip.",
    },
  ],
};

function moduleCommandSchema(name, cmd) {
  return {
    name,
    describe: cmd.describe,
    needsModule: true,
    needsEnv: !!cmd.needsEnv,
    defaultFormat: cmd.defaultFormat,
    flags: COMMAND_FLAGS[name] ?? [],
    positionals: [
      {
        name: "module-path",
        required: true,
        description: "Path to the ES module to inspect.",
      },
      {
        name: "name",
        required: false,
        description: "Component name filter (operate on one component).",
      },
    ],
  };
}

export async function run() {
  const moduleCmds = Object.entries(COMMANDS).map(([name, cmd]) => moduleCommandSchema(name, cmd));
  const noModuleCmds = Object.entries(NO_MODULE_COMMANDS).map(([name, cmd]) => ({
    name,
    describe: cmd.mod.describe,
    needsModule: false,
    flags: cmd.flags,
    positionals: cmd.positionals,
  }));

  const schema = {
    schemaVersion: SCHEMA_VERSION,
    cli: "tutuca",
    version: readPackageVersion(import.meta.url),
    invocation: {
      synopsis: "tutuca <command> <module-path> [name] [flags]",
      moduleFirst: false,
      moduleFlag: "module",
      note: "For module-required commands, the module path is the second positional. Use --module=<path> as an alternative.",
    },
    globalFlags: GLOBAL_FLAGS,
    formats: FORMAT_NAMES,
    exitCodes: EXIT_CODES,
    errorCodes: Object.values(CODES),
    lintCodes: LINT_RULES,
    commands: [...moduleCmds, ...noModuleCmds],
  };

  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
}
