#!/usr/bin/env node
import { COMMANDS } from "./cli/commands/_registry.js";
import * as agentContext from "./cli/commands/agent-context.js";
import * as feedback from "./cli/commands/feedback.js";
import * as help from "./cli/commands/help.js";
import * as installSkill from "./cli/commands/install-skill.js";
import * as storybook from "./cli/commands/storybook.js";
import { CODES, didYouMean, emitError, parseArgsErrorShape } from "./cli/errors.js";
import { runCommand } from "./cli/with-module.js";

const NO_MODULE_COMMANDS = {
  help: help,
  feedback: feedback,
  "install-skill": installSkill,
  storybook: storybook,
  "agent-context": agentContext,
};

const VALID_FORMATS = ["cli", "md", "json", "html"];
const GLOBAL_FLAGS = ["format", "output", "pretty", "module", "json", "help", "no-color"];

function extractGlobals(argv) {
  const rest = [];
  const opts = {
    format: null,
    output: null,
    pretty: false,
    module: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-f" || a === "--format") {
      opts.format = argv[++i];
    } else if (a.startsWith("--format=")) {
      opts.format = a.slice("--format=".length);
    } else if (a === "--json") {
      opts.format = "json";
    } else if (a === "-o" || a === "--output") {
      opts.output = argv[++i];
    } else if (a.startsWith("--output=")) {
      opts.output = a.slice("--output=".length);
    } else if (a === "--pretty") {
      opts.pretty = true;
    } else if (a === "--module") {
      opts.module = argv[++i];
    } else if (a.startsWith("--module=")) {
      opts.module = a.slice("--module=".length);
    } else if (a === "-h" || a === "--help") {
      opts.help = true;
    } else {
      rest.push(a);
    }
  }
  if (opts.format != null && !VALID_FORMATS.includes(opts.format)) {
    emitError(opts, {
      code: CODES.FORMAT_UNKNOWN,
      message: `Unknown format '${opts.format}'`,
      suggestion: didYouMean(opts.format, VALID_FORMATS),
      hint: `Valid formats: ${VALID_FORMATS.join(", ")}`,
    });
  }
  return { opts, rest };
}

function dispatchKnownCommands() {
  return [...Object.keys(COMMANDS), ...Object.keys(NO_MODULE_COMMANDS)];
}

async function main() {
  const { opts, rest } = extractGlobals(process.argv.slice(2));

  if (rest.length === 0) {
    await help.run([], opts);
    return;
  }

  // New shape: tutuca <command> [module-path] [name] [flags]
  // Module path is the second positional for module-required commands,
  // unless --module=<path> was supplied.
  const command = rest[0];

  if (NO_MODULE_COMMANDS[command]) {
    const commandArgs = rest.slice(1);
    const args = opts.help ? [...commandArgs, "--help"] : commandArgs;
    await NO_MODULE_COMMANDS[command].run(args, opts);
    return;
  }

  if (opts.help) {
    await help.run([command], opts);
    return;
  }

  const cmd = COMMANDS[command];
  if (!cmd) {
    const known = dispatchKnownCommands();
    emitError(opts, {
      code: CODES.USAGE_UNKNOWN_COMMAND,
      message: `Unknown command '${command}'`,
      suggestion: didYouMean(command, known),
      hint: "Run `tutuca help` for the full reference.",
    });
  }

  // Module path: second positional unless --module overrides. The module
  // must come immediately after the command, before any per-command flags.
  let commandArgs;
  if (opts.module) {
    commandArgs = rest.slice(1);
  } else if (rest.length < 2 || rest[1].startsWith("-")) {
    emitError(opts, {
      code: CODES.USAGE_MISSING_MODULE,
      message: `'${command}' requires a module path`,
      hint: `Pass it as the second positional: \`tutuca ${command} <module-path>\`, or use --module=<path>.`,
    });
  } else {
    opts.module = rest[1];
    commandArgs = rest.slice(2);
  }

  try {
    await runCommand(cmd, commandArgs, opts);
  } catch (e) {
    if (e?.code === "EXAMPLES_SHAPE_MISMATCH") {
      const parts = [];
      if (opts.module) parts.push(opts.module);
      if (e.where) parts.push(`@ ${e.where}`);
      emitError(opts, {
        code: CODES.MODULE_SHAPE_MISMATCH,
        message: e.message,
        where: parts.length ? parts.join(" ") : null,
      });
    }
    if (e?.code === "ERR_FORMAT_UNKNOWN") {
      emitError(opts, {
        code: CODES.FORMAT_UNKNOWN,
        message: e.message,
        suggestion: didYouMean(e.formatName, e.validFormats ?? VALID_FORMATS),
      });
    }
    if (e?.code === "ERR_FORMAT_UNSUPPORTED") {
      emitError(opts, {
        code: CODES.FORMAT_UNSUPPORTED,
        message: e.message,
        suggestion: e.supportedFormats?.length
          ? { kind: "rewrite", from: e.formatName, to: e.supportedFormats[0] }
          : null,
      });
    }
    if (e?.code?.startsWith?.("ERR_PARSE_ARGS_")) {
      const validFlags = [...Object.keys(cmd.parseOptions ?? {}), ...GLOBAL_FLAGS];
      const shape = parseArgsErrorShape(e, validFlags);
      emitError(opts, {
        ...shape,
        hint: shape.hint ?? `Run \`tutuca help ${command}\` for valid flags.`,
      });
    }
    throw e;
  }
}

main().catch((e) => {
  // Format-aware top-level fallback. We can't recover the global opts here,
  // so fall back to plain text — but if argv contained --json we still want
  // a JSON envelope on stderr.
  const wantsJson =
    process.argv.includes("--json") ||
    process.argv.includes("--format=json") ||
    (() => {
      const i = process.argv.findIndex((a) => a === "-f" || a === "--format");
      return i >= 0 && process.argv[i + 1] === "json";
    })();
  if (wantsJson) {
    const envelope = {
      error: {
        code: e?.code ?? CODES.INTERNAL,
        message: e?.message ?? String(e),
      },
    };
    if (e?.where) envelope.error.where = e.where;
    process.stderr.write(`${JSON.stringify(envelope)}\n`);
  } else {
    process.stderr.write(`${e.stack ?? e.message ?? e}\n`);
  }
  process.exit(1);
});
