// Run the shared DOM scenarios against the js build.
import { runSmoke } from "./smoke-harness.mjs";
import demos from "./demos.json" with { type: "json" };
await runSmoke(
	"js",
	demos.filter((name) => name !== "todo" && name !== "storybook"),
);
