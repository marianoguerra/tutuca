import { parseArgs } from "node:util";
import { loadAndNormalize } from "./load.js";
import { emit } from "./output.js";

export async function runWithModule({ argv, options, globalOpts, defaultFormat, run }) {
  const parsed = parseArgs({
    args: argv,
    options: options ?? {},
    allowPositionals: true,
  });
  const normalized = await loadAndNormalize(globalOpts.module);
  const result = await run(normalized, parsed);
  await emit(result, {
    format: globalOpts.format ?? defaultFormat,
    pretty: globalOpts.pretty,
    output: globalOpts.output,
  });
  return result;
}
