import { lintComponents } from "../../core/lint.js";
import { createNodeEnv } from "../env.js";
import { runWithModule } from "../with-module.js";

export const describe = "Run the lint checks on components (optional <name> for one).";

export async function run(argv, globalOpts) {
  const env = await createNodeEnv();
  const result = await runWithModule({
    argv,
    globalOpts,
    defaultFormat: "cli",
    run: (normalized, { positionals }) =>
      lintComponents(normalized, {
        name: positionals[0] ?? null,
        LintParseContextClass: env.LintParseContext,
      }),
  });
  if (result.hasErrors) process.exit(2);
}
