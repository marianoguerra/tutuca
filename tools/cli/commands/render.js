import { renderExamples } from "../../core/render.js";
import { createNodeEnv } from "../env.js";
import { runWithModule } from "../with-module.js";

export const describe =
  "Render examples to HTML (optional <name> to filter by component).";

export async function run(argv, globalOpts) {
  const env = createNodeEnv();
  const result = await runWithModule({
    argv,
    options: {
      title: { type: "string" },
      view: { type: "string" },
    },
    globalOpts,
    defaultFormat: "md",
    run: (normalized, { values, positionals }) =>
      renderExamples(normalized, env, {
        name: positionals[0] ?? null,
        title: values.title ?? null,
        view: values.view ?? null,
      }),
  });
  if (result.hasErrors) process.exit(3);
}
