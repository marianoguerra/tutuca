import { parseArgs } from "node:util";
import { createNodeEnv } from "./env.js";
import { loadAndNormalize } from "./load.js";
import { emit } from "./output.js";

export async function runCommand(cmd, argv, globalOpts) {
  const parsed = parseArgs({
    args: argv,
    options: cmd.parseOptions ?? {},
    allowPositionals: true,
  });
  const normalized = await loadAndNormalize(globalOpts.module);
  const env = cmd.needsEnv ? await createNodeEnv() : null;
  const result = await cmd.run(normalized, parsed, env);
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
