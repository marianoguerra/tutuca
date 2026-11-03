// The page's functions agents call now (host_call), by module. An agent's
// manifest names the modules it needs ("hostFns": ["jq"]), and the shell
// defines their functions (runtime.defineHostFn) before loading it. A
// module is { bundle, make }: bundle names the engine it needs in
// dist/engines/ (or null), loaded once; make(engine) gives its functions,
// { name: (...args) => value }. Arguments and results are JSON values (a
// map is an object, a list an array); a function throws to answer with an
// error result. They're synchronous: what an engine does asynchronously
// happens in a custom element instead (elements.js).
import * as cron from "./cron.js";
import * as datefmt from "./datefmt.js";
import * as echarts from "./echarts.js";
import * as glob from "./glob.js";
import * as jq from "./jq.js";
import * as json_schema from "./json_schema.js";
import * as jsonpath from "./jsonpath.js";
import * as regex from "./regex.js";
import * as vega from "./vega.js";

export const HOST_FN_MODULES = { cron, datefmt, echarts, glob, jq, json_schema, jsonpath, regex, vega };

// An engine bundle of dist/engines/, imported once.
const bundles = new Map();
export const loadBundle = (name) => {
	if (!bundles.has(name)) bundles.set(name, import(new URL(`../../dist/engines/${name}.js`, import.meta.url)));
	return bundles.get(name);
};

// The modules each runtime has defined, so each is defined once.
const defined = new WeakMap();

// Defines the functions of the modules names in runtime (js/tutuca-rt.js's
// runtime), loading the engines they need.
export async function defineHostFns(runtime, names) {
	if (!defined.has(runtime)) defined.set(runtime, new Set());
	const done = defined.get(runtime);
	for (const name of names) {
		if (done.has(name)) continue;
		const module = HOST_FN_MODULES[name];
		if (!module) throw new Error(`there are no host functions ${name}`);
		const engine = module.bundle ? await loadBundle(module.bundle) : null;
		for (const [fn, impl] of Object.entries(await module.make(engine))) runtime.defineHostFn(fn, impl);
		done.add(name);
	}
}
