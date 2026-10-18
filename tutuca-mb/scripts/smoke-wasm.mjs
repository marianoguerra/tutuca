// Run the shared DOM scenarios against the wasm-gc build.
import { runSmoke } from "./smoke-harness.mjs";
import demos from "./demos.json" with { type: "json" };
await runSmoke("wasm-gc", demos);
