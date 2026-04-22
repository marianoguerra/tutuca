#!/usr/bin/env node
import * as help from "./cli/commands/help.js";
import * as info from "./cli/commands/info.js";
import * as list from "./cli/commands/list.js";
import * as examples from "./cli/commands/examples.js";
import * as docs from "./cli/commands/docs.js";
import * as lint from "./cli/commands/lint.js";
import * as render from "./cli/commands/render.js";
import * as doctor from "./cli/commands/doctor.js";
import * as stresstest from "./cli/commands/stresstest.js";

const COMMANDS = { help, info, list, examples, docs, lint, render, doctor, stresstest };
const MODULELESS = new Set(["help", "stresstest"]);

function usageError(msg) {
  process.stderr.write(`tutuca: ${msg}\nRun \`tutuca help\` for usage.\n`);
  process.exit(1);
}

function extractGlobals(argv) {
  const rest = [];
  const opts = { format: null, output: null, pretty: false, quiet: false, module: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-f" || a === "--format") {
      opts.format = argv[++i];
    } else if (a.startsWith("--format=")) {
      opts.format = a.slice("--format=".length);
    } else if (a === "-o" || a === "--output") {
      opts.output = argv[++i];
    } else if (a.startsWith("--output=")) {
      opts.output = a.slice("--output=".length);
    } else if (a === "--pretty") {
      opts.pretty = true;
    } else if (a === "--quiet") {
      opts.quiet = true;
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
  return { opts, rest };
}

async function main() {
  const { opts, rest } = extractGlobals(process.argv.slice(2));

  if (rest.length === 0 || (opts.help && rest.length === 0)) {
    await help.run([], opts);
    return;
  }

  let command;
  let commandArgs;

  if (rest.length >= 1 && COMMANDS[rest[0]] && MODULELESS.has(rest[0])) {
    command = rest[0];
    commandArgs = rest.slice(1);
  } else if (opts.module) {
    if (rest.length === 0) return usageError("missing command");
    command = rest[0];
    commandArgs = rest.slice(1);
  } else {
    if (rest.length < 2) return usageError("expected <module-path> <command>");
    opts.module = rest[0];
    command = rest[1];
    commandArgs = rest.slice(2);
  }

  const cmd = COMMANDS[command];
  if (!cmd) return usageError(`unknown command: ${command}`);

  if (opts.help) {
    await help.run([command], opts);
    return;
  }

  try {
    await cmd.run(commandArgs, opts);
  } catch (e) {
    if (e?.code === "EXAMPLES_SHAPE_MISMATCH") {
      process.stderr.write(`tutuca: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e.message ?? e}\n`);
  process.exit(1);
});
