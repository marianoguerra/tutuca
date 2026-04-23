import { listComponents } from "../../core/list.js";
import { runWithModule } from "../with-module.js";

export const describe = "List components in the module.";

export async function run(argv, globalOpts) {
  await runWithModule({
    argv,
    globalOpts,
    defaultFormat: "cli",
    run: (normalized) => listComponents(normalized),
  });
}
