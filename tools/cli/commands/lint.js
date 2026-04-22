import { parseArgs } from "node:util";
import { lintComponents } from "../../core/lint.js";
import { createNodeEnv } from "../env.js";
import { loadAndNormalize } from "../load.js";
import { emit } from "../output.js";

export const describe = "Run the lint checks on components (optional <name> for one).";

export async function run(argv, globalOpts) {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const name = positionals[0] ?? null;
  const env = createNodeEnv();
  const normalized = await loadAndNormalize(globalOpts.module);
  const result = lintComponents(normalized, { name, LintParseContextClass: env.LintParseContext });
  await emit(result, { format: globalOpts.format ?? "cli", pretty: globalOpts.pretty, output: globalOpts.output });
  if (result.hasErrors) process.exit(2);
}
