import { listExamples } from "../../core/list-examples.js";
import { runWithModule } from "../with-module.js";

export const describe = "List examples in the module.";

export async function run(argv, globalOpts) {
  await runWithModule({
    argv,
    globalOpts,
    defaultFormat: "cli",
    run: (normalized) => listExamples(normalized),
  });
}
