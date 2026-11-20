// The page's functions agents call, by module. An agent's package names the modules it needs
// ("hostModules": ["jq"]), and the shell gives them to the runtime as it loads the agent. A
// module is { declaration, bundle, make }: declaration is what the agent is checked against;
// bundle names the engine it needs in dist/engines/ (or null), loaded once; make(engine) gives
// its functions, { name: (...args) => value }. Arguments and results are JSON values; a
// function throws to answer with an error. They're synchronous: what an engine does
// asynchronously happens in a custom element instead (elements.js).
import * as cron from "./cron.js";
import * as datefmt from "./datefmt.js";
import * as echarts from "./echarts.js";
import * as glob from "./glob.js";
import * as jq from "./jq.js";
import * as json_schema from "./json_schema.js";
import * as jsonpath from "./jsonpath.js";
import * as regex from "./regex.js";
import * as vega from "./vega.js";

export const HOST_MODULES = {
	cron,
	datefmt,
	echarts,
	glob,
	jq,
	json_schema,
	jsonpath,
	regex,
	vega,
};

// An engine bundle of dist/engines/, imported once.
const bundles = new Map();
export const loadBundle = (name) => {
	if (!bundles.has(name))
		bundles.set(name, import(new URL(`../../dist/engines/${name}.js`, import.meta.url)));
	return bundles.get(name);
};

/**
 * The host modules named, as a runtime's load takes them: each one's declaration with its
 * functions, its engine's bundle loaded first. A module with no declaration gives nothing.
 */
export async function hostModulesFor(names) {
	const out = [];
	for (const name of names) {
		const module = HOST_MODULES[name];
		if (!module) throw new Error(`there is no host module ${name}`);
		if (!module.declaration) continue;
		const engine = module.bundle ? await loadBundle(module.bundle) : null;
		out.push({ ...module.declaration, impls: await module.make(engine) });
	}
	return out;
}
