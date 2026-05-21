import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LINT_RULES } from "../../core/lint-rules.js";
import { COMMANDS } from "./_registry.js";

export const describe =
  "Print a machine-readable schema (commands, flags, exit codes) as JSON.";

const SCHEMA_VERSION = 2;

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
    enum: ["cli", "md", "json", "html"],
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

const ERROR_CODES = [
  "ERR_USAGE_UNKNOWN_COMMAND",
  "ERR_USAGE_UNKNOWN_FLAG",
  "ERR_USAGE_BAD_FLAG_VALUE",
  "ERR_USAGE_MISSING_MODULE",
  "ERR_USAGE_MISSING_ARGUMENT",
  "ERR_USAGE_MUTUALLY_EXCLUSIVE",
  "ERR_FORMAT_UNKNOWN",
  "ERR_FORMAT_UNSUPPORTED",
  "EXAMPLES_SHAPE_MISMATCH",
  "ERR_SKILL_ASSETS_MISSING",
  "ERR_SKILL_TARGET_EXISTS",
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

const NO_MODULE_COMMANDS_META = {
  help: {
    describe: "Show usage. `help <command>` for per-command detail.",
    needsModule: false,
    flags: [{ name: "help", short: "h", type: "boolean" }],
    positionals: [{ name: "command", required: false }],
  },
  feedback: {
    describe: "Append a feedback record to ~/.tutuca/feedback.jsonl.",
    needsModule: false,
    flags: [{ name: "help", short: "h", type: "boolean" }],
    positionals: [
      {
        name: "message",
        required: false,
        note: "Falls back to piped stdin when omitted.",
      },
    ],
  },
  "install-skill": {
    describe:
      "Copy bundled Claude Code skill assets into .claude/skills/<name>/.",
    needsModule: false,
    flags: [
      { name: "user", type: "boolean", description: "Install at ~/.claude/skills/." },
      {
        name: "project",
        type: "boolean",
        description: "Install at ./.claude/skills/ (default).",
      },
      { name: "margaui-skill", type: "boolean" },
      { name: "immutable-skill", type: "boolean" },
      { name: "all", type: "boolean", description: "Install every bundled skill." },
      {
        name: "dot-agents",
        type: "boolean",
        description: "Use .agents/skills/ instead of .claude/skills/.",
      },
      {
        name: "dry-run",
        type: "boolean",
        description: "Print files that would be written; don't touch disk.",
      },
      {
        name: "force",
        short: "f",
        type: "boolean",
        description: "Overwrite existing files.",
      },
      { name: "help", short: "h", type: "boolean" },
    ],
    positionals: [],
  },
  "agent-context": {
    describe: "Print this schema as JSON.",
    needsModule: false,
    flags: [],
    positionals: [],
  },
};

function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "package.json"),
    resolve(here, "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")).version ?? null;
      } catch {
        // try next
      }
    }
  }
  return null;
}

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
  const moduleCmds = Object.entries(COMMANDS).map(([name, cmd]) =>
    moduleCommandSchema(name, cmd),
  );
  const noModuleCmds = Object.entries(NO_MODULE_COMMANDS_META).map(([name, meta]) => ({
    name,
    ...meta,
  }));

  const schema = {
    schemaVersion: SCHEMA_VERSION,
    cli: "tutuca",
    version: packageVersion(),
    invocation: {
      synopsis: "tutuca <command> <module-path> [name] [flags]",
      moduleFirst: false,
      moduleFlag: "module",
      note: "For module-required commands, the module path is the second positional. Use --module=<path> as an alternative.",
    },
    globalFlags: GLOBAL_FLAGS,
    formats: ["cli", "md", "json", "html"],
    exitCodes: EXIT_CODES,
    errorCodes: ERROR_CODES,
    lintCodes: LINT_RULES,
    commands: [...moduleCmds, ...noModuleCmds],
  };

  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
}
