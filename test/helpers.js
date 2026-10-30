// What the tests share: jsdom documents, hosts and scopes on them, waiting for tasks to settle,
// the checks every component library runs (lint clean, generic properties) and raw vnodes.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { lint } from "../src/lint/index.js";
import { arbitraries, Driver, specProperties } from "../src/test/pbt.js";
import { Host, Scope, testEnv } from "../src/tutuca.js";
import { Shape, toVChilds, VComment, VFragment, VNode } from "../src/vdom.js";

// --- documents, hosts and scopes ---------------------------------------------------------

export const dom = (html = "", options) => new JSDOM(html, options).window;
// A document for tests that only render into detached nodes.
export const { document } = dom();

// A Host on a new <main> with specs registered, and C its components. sync stops the timer
// tick and has notify run right away, collecting taskFailed errors in failures and passing
// every report to onReport, so a test drives the queue with drain() and click(target).
export const setupHost = (specs, { dev = false, sync = false, onReport = null } = {}) => {
	const window = dom();
	const rootNode = window.document.createElement("main");
	const host = new Host({ document: window.document, rootNode, dev, env: testEnv() });
	const failures = [];
	if (sync) {
		host.notify = (type, info) => {
			if (type === "taskFailed") failures.push(info.error);
			onReport?.(type, info);
		};
		host.scheduleNextTaskTick = () => {};
	}
	host.scope.register(specs);
	const drain = () => {
		while (host.tasks.length > 0) host.handleTasks();
	};
	const click = (target) => {
		host.handleEvent({ type: "click", target });
		drain();
	};
	return { window, host, rootNode, C: host.scope.components, failures, drain, click };
};
// setupHost for one component, started with Comp(args) as the root.
export const startHost = (Comp, args, options) => {
	const setup = setupHost({ Comp }, options);
	setup.host.start(setup.C.Comp(args));
	return setup;
};

export const scopeWith = (components) => {
	const scope = new Scope(() => {});
	scope.register(components);
	return scope;
};

// One turn of the event loop.
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// Lets tasks, notifications and the renders they cause settle.
export const settle = async () => {
	for (let i = 0; i < 5; i++) await tick();
};

// The mutation records fn causes under node.
export const mutationsOf = async (window, node, fn) => {
	const records = [];
	const observer = new window.MutationObserver((rs) => records.push(...rs));
	observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
	fn();
	await tick();
	observer.disconnect();
	return records;
};

// The text root renders, without the tutuca comments and whitespace between elements.
export const textOf = (root) => {
	const driver = new Driver({ root, document });
	return driver.rootNode.textContent.replace(/\s+/g, "");
};

// --- the checks component libraries run --------------------------------------------------

// A test that components lint clean, with names the components registered beside them.
export const testLintsClean = (
	title,
	components,
	{ names = Object.keys(components), errorsOnly = false } = {},
) =>
	test(`the ${title} components lint clean`, () => {
		const issues = lint(Object.values(components), names);
		const shown = errorsOnly ? issues.filter((i) => i.level === "error") : issues;
		assert.deepEqual(
			shown.map((i) => `${i.code} ${i.path}: ${i.message}`),
			[],
		);
	});

// A test per component that it has pbt.js's generic properties, with arbitraries over a scope
// of registered (the components, by default) and overrides.
export const testGenericProperties = (
	components,
	{ registered = components, overrides = {}, numRuns = 30 } = {},
) => {
	for (const [name, spec] of Object.entries(components)) {
		test(`${name} has the generic properties`, () => {
			const A = arbitraries({ fc, scope: scopeWith(registered), overrides });
			for (const [propName, prop] of Object.entries(specProperties(spec, A, { document }))) {
				try {
					fc.assert(prop, { numRuns });
				} catch (error) {
					error.message = `${name}.${propName}: ${error.message}`;
					throw error;
				}
			}
		});
	}
};

// --- raw vnodes ----------------------------------------------------------------------------

// Builds raw vnodes for vdom-level tests, the way tutuca's DomNode would: every attr is dynamic
// and shapes are cached by tag, namespace and attr names, so equal templates share a shape.
const shapes = new Map();
const shapeFor = (tag, namespace, names) => {
	const id = JSON.stringify([tag, namespace, names]);
	if (!shapes.has(id))
		shapes.set(
			id,
			new Shape(
				tag,
				namespace,
				names.map((name) => [name, false]),
			),
		);
	return shapes.get(id);
};

export const vchilds = toVChilds;

export function vh(tag, attrs = {}, children = null) {
	const { key, namespace = null, ...rest } = attrs;
	const names = Object.keys(rest);
	const values = names.map((name) => rest[name]);
	return new VNode(shapeFor(tag, namespace, names), values, vchilds(children), key);
}
export const vfrag = (children, key) => new VFragment(vchilds(children), key);
export const vcomment = (text) => new VComment(text);
