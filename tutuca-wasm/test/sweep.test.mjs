// Every component of every pure-tutuca module in the repository, made from its defaults and
// rendered, then sent the same events, in tutuca (JavaScript) and in tutuca-wasm: the same
// state, the same problems and the same page after each.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { componentModule } from "../../src/pure/module.js";
import { Driver, testEnv } from "../../src/testing/driver.js";
import { Scope } from "../../src/tutuca.js";
import { dom } from "../../test/helpers.js";
import { createRuntime } from "../js/tutuca-wasm.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Where the modules are.
const DIRS = [
	"spec/pure-tutuca/conformance/accept",
	"components",
	"tutuca-wasm/components",
	"tutuca-wasm/studio",
	"tutuca-wasm/microagents",
];
// The page's host modules the micro-agents import: each engine's declaration and functions,
// the same for both runtimes. One whose engine isn't built is left out, and its agent with it.
const { HOST_MODULES, loadBundle } = await import("../microagents/engines/index.js");
const hostModules = [];
for (const module of Object.values(HOST_MODULES)) {
	if (!module.declaration) continue;
	try {
		const engine = module.bundle ? await loadBundle(module.bundle) : null;
		hostModules.push({ ...module.declaration, impls: await module.make(engine) });
	} catch {}
}
const SKIP = new Set(["spec/pure-tutuca/conformance/accept/words.tutuca.ts"]);

const files = [];
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (name === "node_modules" || name.startsWith(".")) continue;
		if (statSync(path).isDirectory()) walk(path);
		else if (name.endsWith(".tutuca.ts")) files.push(path);
	}
};
for (const dir of DIRS) walk(join(root, dir));

const read = (file) => readFileSync(file, "utf8");
const resolverOf = (file) => (spec) => {
	try {
		return read(resolve(dirname(file), spec.endsWith(".ts") ? spec : `${spec}.ts`));
	} catch {
		return null;
	}
};
// The component modules a module imports types from: loaded first, as a page would.
const importsOf = (file) =>
	[...read(file).matchAll(/from "(\.[^"]*\.tutuca)(?:\.ts)?"/g)].map((m) =>
		resolve(dirname(file), `${m[1]}.ts`),
	);
const shown = (node) => {
	const seen = new Map();
	return node.innerHTML.replace(/data-eid="(\d+)"/g, (_, id) => {
		if (!seen.has(id)) seen.set(id, seen.size);
		return `data-eid="${seen.get(id)}"`;
	});
};

// What each component of a module is made from: nothing, and, for a micro-agent's root, each
// of the samples beside it.
const startsOf = (file, components) => {
	const starts = components.map((component) => [component, {}, ""]);
	const dir = dirname(file);
	let manifest;
	try {
		manifest = JSON.parse(read(join(dir, "manifest.json")));
	} catch {
		return starts;
	}
	for (const sample of readdirSync(join(dir, "samples")).sort()) {
		if (sample.endsWith(".json")) {
			starts.push([
				manifest.root,
				JSON.parse(read(join(dir, "samples", sample))),
				` from ${sample}`,
			]);
		}
	}
	return starts;
};

// What went wrong in a run of reports, in words both runtimes say.
const issuesOf = (reports) =>
	reports
		.flatMap((r) => [
			...(r.outcome === "failed" || (r.error !== undefined && r.error !== null) ? ["failed"] : []),
			...(r.issues ?? []).map((i) =>
				i.check === "state" ? `${i.field ?? i.component}: ${i.reason}` : i.reason,
			),
		])
		.sort();

describe("every component makes, renders and answers events the same in both runtimes", () => {
	for (const file of files.sort()) {
		const name = relative(root, file);
		if (SKIP.has(name)) continue;
		test(name, async (t) => {
			const loaded = componentModule(read(file), { resolve: resolverOf(file), hostModules });
			// An agent whose engine isn't built here can't be checked: what it imports isn't there.
			if (loaded.diagnostics.some((d) => d.code === "unknown-import"))
				return t.skip("its engine isn't built");
			assert.deepEqual(
				loaded.diagnostics.map((d) => d.code),
				[],
			);
			for (const [component, fields, from] of startsOf(file, Object.keys(loaded.components))) {
				const scope = new Scope();
				const page = dom().document;
				const node = page.createElement("main");
				const wasm = await createRuntime({ env: testEnv(), document: page, rootNode: node });
				for (const dep of importsOf(file)) {
					const d = componentModule(read(dep), { resolve: resolverOf(dep), hostModules });
					scope.registerInterfaces(d.interfaces);
					scope.registerAskHandlers(d.askHandlers);
					scope.registerMetaSchemas(d.metaSchemas);
					scope.register(d.components);
					assert.equal(
						(await wasm.load(read(dep), { resolve: resolverOf(dep), hostModules, register: {} }))
							.ok,
						true,
						dep,
					);
				}
				scope.registerInterfaces(loaded.interfaces);
				scope.registerAskHandlers(loaded.askHandlers);
				scope.registerMetaSchemas(loaded.metaSchemas);
				scope.register(loaded.components);
				const inWasm = await wasm.load(read(file), {
					resolve: resolverOf(file),
					hostModules,
					register: {},
				});
				assert.deepEqual(inWasm.diagnostics, [], `${component}: loads in tutuca-wasm`);
				// A component that can't be made from nothing can't in either, for the same reason.
				let root;
				try {
					root = scope.make(component, fields);
				} catch (error) {
					assert.throws(() => wasm.start(component, fields), { message: error.message }, component);
					continue;
				}
				const js = new Driver({ root, document: dom().document });
				wasm.start(component, fields);
				wasm.mount();
				assert.deepEqual(
					wasm.state(),
					JSON.parse(JSON.stringify(js.state)),
					`${component}${from}: made`,
				);
				assert.equal(shown(node), shown(js.rootNode), `${component}${from}: what the page shows`);
				// Then the same events on both, picked by a fixed sequence from the elements that have
				// bindings: whatever they do, they do the same.
				let seed = 7;
				const next = (n) => {
					seed = (seed * 1103515245 + 12345) % 2147483648;
					return seed % n;
				};
				const EVENTS = [
					["click", {}],
					["input", { value: "abc" }],
					["input", { value: "12" }],
					["change", { checked: true }],
					["keydown", { key: "Enter" }],
					["click", {}],
				];
				for (let step = 0; step < 40; step++) {
					const count = js.rootNode.querySelectorAll("[data-eid]").length;
					if (count === 0) break;
					const at = next(count);
					const [type, { value, checked, ...init }] = EVENTS[next(EVENTS.length)];
					const before = [js.reports.length, wasm.reports().length];
					for (const root of [js.rootNode, node]) {
						const el = root.querySelectorAll("[data-eid]")[at];
						if (value !== undefined && "value" in el) el.value = value;
						if (checked !== undefined && "checked" in el) el.checked = checked;
						const { Event, KeyboardEvent } = el.ownerDocument.defaultView;
						const Kind = "key" in init ? KeyboardEvent : Event;
						el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, ...init }));
					}
					const where = `${component}${from}: after ${type} on element ${at} (step ${step})`;
					assert.deepEqual(
						issuesOf(wasm.reports().slice(before[1])),
						issuesOf(js.problems.filter((r) => js.reports.indexOf(r) >= before[0])),
						`${where}: what went wrong`,
					);
					assert.deepEqual(wasm.state(), JSON.parse(JSON.stringify(js.state)), where);
					assert.equal(shown(node), shown(js.rootNode), `${where}: what the page shows`);
				}
			}
		});
	}
});
