// Run the shared DOM scenarios against the js build.
import { runSmoke } from "./smoke-harness.mjs";
await runSmoke("js", ["todo"]);
