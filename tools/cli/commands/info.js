import { describeModule } from "../../core/describe.js";
import { runWithModule } from "../with-module.js";

export const describe = "Summarize the module's exports and counts.";

export async function run(argv, globalOpts) {
  await runWithModule({
    argv,
    globalOpts,
    defaultFormat: "cli",
    run: (normalized) => describeModule(normalized.mod, { path: normalized.path }),
  });
}
