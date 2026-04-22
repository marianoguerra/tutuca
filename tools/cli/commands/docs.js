import { parseArgs } from "node:util";
import { docComponents } from "../../core/docs.js";
import { loadAndNormalize } from "../load.js";
import { emit } from "../output.js";

export const describe = "Produce API docs for components (optional <name> for one).";

export async function run(argv, globalOpts) {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const name = positionals[0] ?? null;
  const normalized = await loadAndNormalize(globalOpts.module);
  const result = docComponents(normalized, { name });
  await emit(result, { format: globalOpts.format ?? "md", pretty: globalOpts.pretty, output: globalOpts.output });
}
