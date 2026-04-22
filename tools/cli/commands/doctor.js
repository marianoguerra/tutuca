import { parseArgs } from "node:util";
import { runDoctor } from "../../core/doctor.js";
import { createNodeEnv } from "../env.js";
import { loadAndNormalize } from "../load.js";
import { emit } from "../output.js";

export const describe = "Run lint + render as a smoke test over the module.";

export async function run(argv, globalOpts) {
  parseArgs({ args: argv, options: {}, allowPositionals: true });
  const env = createNodeEnv();
  const normalized = await loadAndNormalize(globalOpts.module);
  const result = runDoctor(normalized, env);
  await emit(result, { format: globalOpts.format ?? "cli", pretty: globalOpts.pretty, output: globalOpts.output });
  if (result.lint.hasErrors) process.exit(2);
  if (result.renders.hasErrors) process.exit(3);
}
