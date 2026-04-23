import { docComponents } from "../../core/docs.js";
import { runWithModule } from "../with-module.js";

export const describe = "Produce API docs for components (optional <name> for one).";

export async function run(argv, globalOpts) {
  await runWithModule({
    argv,
    globalOpts,
    defaultFormat: "md",
    run: (normalized, { positionals }) =>
      docComponents(normalized, { name: positionals[0] ?? null }),
  });
}
