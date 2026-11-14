// The render cache benchmark on jsdom: a dev-only script, not part of the CLI.
// node --expose-gc scripts/bench-render.js [--size N] [--updates N]
// The same benchmark runs in a browser on a real DOM: just serve, then open
// scripts/bench/render.html (?size=N&updates=N). The benchmark itself is scripts/bench/render.js.
import { parseArgs } from "node:util";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { runBench } from "./bench/render.js";

const { values: args } = parseArgs({
	options: {
		size: { type: "string", default: "2000" },
		updates: { type: "string", default: "40" },
	},
});
const mount = () => {
	const { document } = new JSDOM("<main></main>").window;
	return { document, rootNode: document.querySelector("main"), unmount: () => {} };
};
await runBench({
	size: Number(args.size),
	updates: Number(args.updates),
	mount,
	log: (line) => console.log(line),
});
