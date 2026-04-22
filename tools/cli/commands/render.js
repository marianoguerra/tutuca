import { parseArgs } from "node:util";
import { renderExamples } from "../../core/render.js";
import { createNodeEnv } from "../env.js";
import { loadAndNormalize } from "../load.js";
import { emit } from "../output.js";

export const describe = "Render examples to HTML (optional <name> to filter by component).";

export async function run(argv, globalOpts) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      title: { type: "string" },
      view: { type: "string" },
    },
    allowPositionals: true,
  });
  const name = positionals[0] ?? null;
  const env = createNodeEnv();
  const normalized = await loadAndNormalize(globalOpts.module);
  const result = renderExamples(normalized, env, { name, title: values.title ?? null, view: values.view ?? null });
  await emit(result, { format: globalOpts.format ?? "md", pretty: globalOpts.pretty, output: globalOpts.output });
  if (result.hasErrors) process.exit(3);
}
