import { runDoctor } from "../../core/doctor.js";
import { createNodeEnv } from "../env.js";
import { runWithModule } from "../with-module.js";

export const describe = "Run lint + render as a smoke test over the module.";

export async function run(argv, globalOpts) {
  const env = await createNodeEnv();
  const result = await runWithModule({
    argv,
    globalOpts,
    defaultFormat: "cli",
    run: (normalized) => runDoctor(normalized, env),
  });
  if (result.lint.hasErrors) process.exit(2);
  if (result.renders.hasErrors) process.exit(3);
}
