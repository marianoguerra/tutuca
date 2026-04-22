import { parseArgs } from "node:util";
import { listExamples } from "../../core/list-examples.js";
import { loadAndNormalize } from "../load.js";
import { emit } from "../output.js";

export const describe = "List examples in the module.";

export async function run(argv, globalOpts) {
  parseArgs({ args: argv, options: {}, allowPositionals: true });
  const normalized = await loadAndNormalize(globalOpts.module);
  const result = listExamples(normalized);
  await emit(result, { format: globalOpts.format ?? "cli", pretty: globalOpts.pretty, output: globalOpts.output });
}
