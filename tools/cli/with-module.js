import { statSync } from "node:fs";
import { parseArgs } from "node:util";
import { createNodeEnv } from "./env.js";
import { CODES, emitError } from "./errors.js";
import { loadAndNormalize } from "./load.js";
import { emit } from "./output.js";
import { walkFiles } from "./walk.js";

export async function runCommand(cmd, argv, globalOpts) {
  const parsed = parseArgs({
    args: argv,
    options: cmd.parseOptions ?? {},
    allowPositionals: true,
  });

  let stat = null;
  try {
    stat = statSync(globalOpts.module);
  } catch {
    // Non-existent path — let loadAndNormalize raise the coded MODULE_LOAD_FAILED.
  }

  if (stat?.isDirectory()) {
    await runOnDir(cmd, parsed, globalOpts);
    return;
  }

  const normalized = await loadAndNormalize(globalOpts.module);
  const env = cmd.needsEnv ? await createNodeEnv() : null;
  const result = await cmd.run(normalized, parsed, env);
  await emitResult(cmd, result, globalOpts);
}

// A directory was passed. Only commands that opt in (`acceptsDir`, currently just
// `test`) walk it and run every matching module; the rest report a clean error.
async function runOnDir(cmd, parsed, globalOpts) {
  if (!cmd.acceptsDir) {
    emitError(globalOpts, {
      code: CODES.MODULE_LOAD_FAILED,
      message: `expected a module file, got a directory: ${globalOpts.module}`,
      hint: "This command takes a single module file (.js). Pass a file path.",
    });
    return;
  }

  const files = walkFiles(globalOpts.module, { match: cmd.dirMatch });
  const normalizedAll = [];
  for (const file of files) {
    const normalized = await loadAndNormalize(file);
    if (!cmd.dirFilter || cmd.dirFilter(normalized)) normalizedAll.push(normalized);
  }
  if (normalizedAll.length === 0) {
    emitError(globalOpts, {
      code: CODES.MODULE_LOAD_FAILED,
      message: `no test modules found under ${globalOpts.module}`,
      hint: "Test modules are *.test.js / *.dev.js files that export getTests().",
    });
    return;
  }

  const env = cmd.needsEnv ? await createNodeEnv() : null;
  const results = [];
  for (const normalized of normalizedAll) results.push(await cmd.run(normalized, parsed, env));
  await emitResult(cmd, cmd.mergeResults(results), globalOpts);
}

async function emitResult(cmd, result, globalOpts) {
  await emit(result, {
    format: globalOpts.format ?? cmd.defaultFormat,
    pretty: globalOpts.pretty,
    output: globalOpts.output,
  });
  if (cmd.exitOn) {
    const code = cmd.exitOn(result);
    if (code) process.exit(code);
  }
}
