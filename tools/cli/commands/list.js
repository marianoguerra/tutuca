import { parseArgs } from "node:util";
import { listComponents } from "../../core/list.js";
import { loadAndNormalize } from "../load.js";
import { emit } from "../output.js";

export const describe = "List components in the module.";

export async function run(argv, globalOpts) {
  parseArgs({ args: argv, options: {}, allowPositionals: true });
  const normalized = await loadAndNormalize(globalOpts.module);
  const result = listComponents(normalized);
  await emit(result, { format: globalOpts.format ?? "cli", pretty: globalOpts.pretty, output: globalOpts.output });
}
