// What the tests share: jsdom documents, hosts and scopes on them, waiting for tasks to settle,
// the checks every component library runs (lint clean, generic properties) and raw vnodes.
import assert from "node:assert/strict";
import test from "node:test";
import { compileFunction } from "node:vm";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { DevChecks } from "../src/dev/checks.js";
import { renderJs } from "../src/jsast/index.js";
import { lint, lintScope } from "../src/lint/index.js";
import { planToolCall } from "../src/meta/index.js";
import { Driver, snapshot, testEnv } from "../src/testing/driver.js";
import { arbitraries, specProperties } from "../src/testing/pbt.js";
import { MessageContext, Scheduler } from "../src/tree/index.js";
import { component, Host, Scope, t } from "../src/tutuca.js";
import { Shape, toVChildren, VComment, VFragment, VNode } from "../src/vdom/index.js";

// --- documents, hosts and scopes ---------------------------------------------------------

export const dom = (html = "", options) => new JSDOM(html, options).window;
// A document for tests that only render into detached nodes.
export const { document } = dom();

// A Host on a new <main> with specs registered, and C its components. sync stops the timer
// tick and has the host publish its reports right away, collecting the errors of failed tasks
// in failures and passing every report (a Transition or a HostEvent) to onReport, so a test
// drives the queue with drain() and click(target).
export const setupHost = (specs, { dev = false, sync = false, onReport = null } = {}) => {
	const window = dom();
	const rootNode = window.document.createElement("main");
	const failures = [];
	const publish = (record) => {
		if (record.outcome === "failed") failures.push(record.error);
		onReport?.(record);
	};
	const host = new Host({
		document: window.document,
		rootNode,
		checks: dev ? DevChecks : null,
		env: testEnv(),
		...(sync ? { publish, schedule: () => () => {} } : {}),
	});
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

// A Host without a page, in dev mode, with specs registered (C, their factories) and its
// reports collected in reports as they're made.
export const devHost = (specs) => {
	const reports = [];
	const host = new Host({ checks: DevChecks, publish: (record) => reports.push(record) });
	return { host, reports, C: host.scope.register(specs) };
};
// A leaf component with a pure bump, for tests of trees of components.
export const Leaf = component({
	name: "Leaf",
	fields: { n: t.number(), tags: t.array(t.string()) },
	on: {
		bump: {
			pure: true,
			run(next) {
				next.n += 1;
			},
		},
	},
});
// src/tree's Scheduler over a store holding root, without components: handler(node, task) and
// askHandler(node, name) find what runs, transactions write in place and transition(record)
// hears what became of each task. run() steps it until nothing is queued.
export const treeHarness = ({ root, handler, askHandler = () => null, transition = () => {} }) => {
	const store = { root, get: () => store.root, set: (r) => (store.root = r) };
	const scheduler = new Scheduler({
		handlers: { handler, askHandler },
		store,
		transact: (r, path, fn) => path.setIn(r, fn(path.getIn(r))),
		hooks: {
			context: (task, _node, nextRequest) => new MessageContext(task, nextRequest),
			transition,
		},
	});
	const run = () => {
		while (!scheduler.isEmpty) scheduler.step();
	};
	return { store, scheduler, run };
};

export const scopeWith = (components) => {
	const scope = new Scope();
	scope.register(components);
	return scope;
};

// One turn of the event loop, or ms of them.
export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
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

// The reports host makes from now on of failed tasks and invalid states.
export const collectProblems = (host) => {
	const problems = [];
	host.listen((record) => {
		if (record.outcome === "failed" || record.issues.some((i) => i.check === "state")) {
			problems.push(record);
		}
	});
	return problems;
};
// A demo started by start(document, ...args) on a page with an #app, as a browser would run
// it: fire(type, el, value) sets el's value (when given), dispatches the event and runs every
// task it causes, so what it started (an ask's answer, a notify) lands before the next line.
export const mountDemo = (start, ...args) => {
	const window = dom('<div id="app"></div>');
	const host = start(window.document, ...args);
	const problems = collectProblems(host);
	const rootNode = window.document.getElementById("app");
	const $ = (selector) => rootNode.querySelector(selector);
	const fire = (type, el, value) => {
		if (value !== undefined) el.value = value;
		const Event = type === "click" ? window.MouseEvent : window.Event;
		el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
		while (host.tasks.length > 0) host.handleTasks();
	};
	return { window, host, rootNode, $, fire, problems, state: () => host.root };
};

// --- the checks component libraries run --------------------------------------------------

// Lint issues as lines to compare with [], only the errors with errorsOnly.
export const issueLines = (issues, { errorsOnly = false } = {}) =>
	(errorsOnly ? issues.filter((i) => i.level === "error") : issues).map(
		(i) => `${i.code} ${i.path}: ${i.message}`,
	);
// That a host's demo renders, made no problems and what it registered lints without errors.
export const assertClean = async ({ host, rootNode, problems }) => {
	await settle();
	assert.ok(rootNode.childNodes.length > 0, "renders");
	assert.deepEqual(problems, []);
	assert.deepEqual(issueLines(lintScope(host.scope), { errorsOnly: true }), []);
};

// A test that components lint clean, with names the components registered beside them.
export const testLintsClean = (
	title,
	components,
	{ names = Object.keys(components), errorsOnly = false } = {},
) =>
	test(`the ${title} components lint clean`, () => {
		assert.deepEqual(issueLines(lint(Object.values(components), names), { errorsOnly }), []);
	});

// A test per component with a renders.js that it's the code that makes it in its state: run
// with a scope's components as C, it makes an equal instance, of any state the arbitraries make.
export const testRendersItsCode = (components, { numRuns = 50 } = {}) => {
	for (const [name, spec] of Object.entries(components)) {
		if (spec.renders.js === undefined) continue;
		test(`${name}'s renders.js makes it in its state`, () => {
			const scope = scopeWith(components);
			const A = arbitraries({ fc, scope });
			fc.assert(
				fc.property(A.instance(name), (instance) => {
					const code = renderJs(instance);
					// In this realm: its objects and arrays have the prototypes the instance's have.
					const made = compileFunction(`return (${code});`, ["C"])(scope.components);
					assert.deepEqual(snapshot(made), snapshot(instance), code);
				}),
				{ numRuns },
			);
		});
	}
};

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

// --- agent tools ---------------------------------------------------------------------------

let calls = 0;
// Runs the tool name with args on c: { done: { text, isError }, next } or { send, result }.
export const callTool = (c, name, args = {}) =>
	planToolCall(c, { id: `call-${++calls}`, name, arguments: args });
// c after the tool, which must run here and succeed.
export const ranTool = (c, name, args) => {
	const plan = callTool(c, name, args);
	assert.ok(plan.done, `${name} runs here`);
	assert.equal(plan.done.isError, false, plan.done.text);
	return plan.next;
};

// --- raw vnodes ----------------------------------------------------------------------------

// Builds raw vnodes for vdom-level tests, the way tutuca's Element would: every attr is dynamic
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

export const vchildren = toVChildren;

export function vh(tag, attrs = {}, children = null) {
	const { key, namespace = null, ...rest } = attrs;
	const names = Object.keys(rest);
	const values = names.map((name) => rest[name]);
	return new VNode(shapeFor(tag, namespace, names), values, vchildren(children), key);
}
export const vfrag = (children, key) => new VFragment(vchildren(children), key);
export const vcomment = (text) => new VComment(text);
// The messages a report says nobody handles: a transition's unhandled, none for the rest.
export const unhandledNames = (record) => (record.kind === "transition" ? record.unhandled : []);
// What a report says happened: a transition's outcome, a host event's type.
export const reportType = (record) => record.outcome ?? record.type;
// The reasons of the message issues in reports: what broke a message's spec, in order.
export const messageReasons = (reports) =>
	reports.flatMap((r) => r.issues.filter((i) => i.check === "message").map((i) => i.reason));
