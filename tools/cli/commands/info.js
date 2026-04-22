import { parseArgs } from "node:util";
import { describeModule } from "../../core/describe.js";
import { loadAndNormalize } from "../load.js";
import { emit } from "../output.js";

export const describe = "Summarize the module's exports and counts.";

export async function run(argv, globalOpts) {
  parseArgs({ args: argv, options: {}, allowPositionals: true });
  const normalized = await loadAndNormalize(globalOpts.module);
  const info = describeModule(normalized.mod, { path: normalized.path });
  await emit(info, { format: globalOpts.format ?? "cli", pretty: globalOpts.pretty, output: globalOpts.output });
}
