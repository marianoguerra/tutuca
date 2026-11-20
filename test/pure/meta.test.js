// A pure-tutuca module's meta: argument names and call queries kept for tools, hand-written meta
// whose keys with a default may be left out, componentModule's meta option (a namespace's schema
// typing it as it's written, required, or derived from the definition) and the agent meta
// derived from it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	AGENT_META,
	agentMetaOption,
	agentMetaSchemas,
	agentProblems,
	planToolCall,
	summaryOf,
	systemPrompt,
	toolsFor,
} from "../../src/meta/index.js";
import { componentModule } from "../../src/pure/module.js";
import { Scope } from "../../src/tutuca.js";

const counter = (meta = "") => `import { div, field } from "tutuca/view";
export type Counter = { label: string; count: number };
export const Counter = {${meta}
	defaults: { label: "Clicks", count: 0 },
	queries: { plus(n: number): number { return this.count + n; } },
	on: {
		inc: { pure: true, run(next) { next.count += 1; } },
		add: { pure: true, run(next, [n]: [number]) { next.count += n; } },
	},
	view: div(field("count")),
};`;
const agentMeta = (text) => `\n\tmeta: { "${AGENT_META}": ${text} },`;
// An instance of Counter as module compiles it, in a scope that checks agent meta.
const instanceOf = (r) => {
	assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
	const scope = new Scope();
	scope.registerMetaSchemas(agentMetaSchemas);
	scope.register(r.components);
	return scope.make("Counter", {});
};
const codes = (r) => r.diagnostics.map((d) => d.code);
const option = (mode) => ({ meta: { [AGENT_META]: agentMetaOption(mode) } });

describe("what a module keeps for tools", () => {
	test("run(next) takes nothing; run(next, [n]: [number]) takes n", () => {
		const { on } = componentModule(counter()).components.Counter;
		assert.deepEqual([on.inc.args, on.inc.params], [[], []]);
		assert.equal(on.add.args.length, 1);
		assert.deepEqual(on.add.params, ["n"]);
	});

	test("a call query has its parameters' types and names", () => {
		const { plus } = componentModule(counter()).components.Counter.queries;
		assert.equal(plus.kind, "call");
		assert.equal(plus.args.length, 1);
		assert.deepEqual(plus.params, ["n"]);
	});

	test("hand-written agent meta leaves out what has a default, at any depth", () => {
		const c = instanceOf(
			componentModule(
				counter(agentMeta(`{ summary: null, tools: [{ name: "inc", kind: "message" }] }`)),
			),
		);
		assert.deepEqual(agentProblems(c), []);
		assert.deepEqual(
			toolsFor(c).map((tool) => tool.name),
			["inc"],
		);
	});
});

describe("componentModule's meta option", () => {
	test("check: what a component says under the namespace is typed as it's written", () => {
		const source = counter(agentMeta(`{ tools: [{ name: 3 }] }`));
		const r = componentModule(source, option("check"));
		assert.deepEqual(codes(r), ["not-assignable"]);
		assert.equal(source.slice(r.diagnostics[0].start, r.diagnostics[0].end), "3");
		const typo = componentModule(counter(agentMeta(`{ tool: ["inc"] }`)), option("check"));
		assert.deepEqual(codes(typo), ["excess-property"]);
		// An empty list takes its element type from the schema.
		assert.equal(
			componentModule(
				counter(agentMeta(`{ summary: null, tools: [{ name: "inc", params: [] }] }`)),
				option("check"),
			).ok,
			true,
		);
	});

	test("check: what the schema can't say is a problem, where the meta is", () => {
		// summary says which query summarizes it: Counter has none, so it says none (its state).
		const source = counter(agentMeta(`{ summary: null, tools: [{ name: "explode" }] }`));
		const r = componentModule(source, option("check"));
		assert.deepEqual(codes(r), ["meta-problem"]);
		assert.match(
			r.diagnostics[0].message,
			/tool explode runs message explode, which it doesn't have/,
		);
		assert.ok(source.slice(r.diagnostics[0].start).startsWith(`"${AGENT_META}"`));
	});

	test("check: a component that says nothing is fine; require: it's missing-meta", () => {
		assert.equal(componentModule(counter(), option("check")).ok, true);
		const r = componentModule(counter(), option("require"));
		assert.deepEqual(codes(r), ["missing-meta"]);
		assert.match(
			r.diagnostics[0].help,
			/add meta: \{ "https:\/\/tutuca.dev\/meta\/agent": \{ \.\.\. \} \} to Counter/,
		);
	});

	test("other namespaces are as they're written", () => {
		const r = componentModule(
			counter(`\n\tmeta: { "urn:example:other": { width: 240 } },`),
			option("check"),
		);
		assert.equal(r.ok, true);
	});

	test("derive: a tool per message and query, the state as summary, and a note", () => {
		const r = componentModule(counter(), option("derive"));
		assert.deepEqual(
			r.warnings.map((w) => w.code),
			["derived-meta"],
		);
		const c = instanceOf(r);
		assert.deepEqual(agentProblems(c), []);
		assert.deepEqual(
			toolsFor(c).map((tool) => `${tool.name}(${Object.keys(tool.parameters.properties)})`),
			["inc()", "add(n)", "plus(n)"],
		);
		assert.equal(summaryOf(c), '{"label":"Clicks","count":0}');
		assert.equal(
			planToolCall(c, { name: "add", arguments: { n: 5 } }).done.text,
			'{"label":"Clicks","count":5}',
		);
	});

	test("derive: what a component says wins, its tools by name", () => {
		const said = agentMeta(
			`{ prompt: "Counts.", tools: [{ name: "add", kind: "message", description: "Add n.", params: ["n"] }] }`,
		);
		const c = instanceOf(componentModule(counter(said), option("derive")));
		const tools = toolsFor(c);
		assert.deepEqual(
			tools.map((tool) => tool.name),
			["inc", "plus", "add"],
		);
		assert.equal(tools.find((tool) => tool.name === "add").description, "Add n.");
	});
});

describe("doc comments in derived agent meta", () => {
	const documented = `import { div, field } from "tutuca/view";
/** A counter of things. */
export type Counter = {
	/** What it counts. */
	label: string;
	count: number;
	/** @summary */
	readonly summary: string;
};
export const Counter = {
	defaults: { label: "Clicks", count: 0 },
	queries: {
		get summary(): string { return this.label; },
		/**
		 * The count plus n.
		 * @param n what to add
		 */
		plus(n: number): number { return this.count + n; },
	},
	on: {
		/**
		 * Add n to the count.
		 * @param n how many, may be negative
		 */
		add: { pure: true, run(next, [n]: [number]) { next.count += n; } },
		/** @hidden */
		reset: { pure: true, run(next) { next.count = 0; } },
	},
	view: div(field("count")),
};`;

	test("describe the tools and their params, hide some, pick the summary, make the prompt", () => {
		const c = instanceOf(componentModule(documented, option("derive")));
		assert.deepEqual(agentProblems(c), []);
		const tools = toolsFor(c).map((tool) => [
			tool.name,
			tool.description,
			tool.parameters.properties.n?.description ?? null,
		]);
		assert.deepEqual(tools, [
			["add", "Add n to the count.", "how many, may be negative"],
			["plus", "The count plus n. (reads, changes nothing)", "what to add"],
		]);
		assert.equal(summaryOf(c), "Clicks");
		assert.match(
			systemPrompt(c),
			/A counter of things\. Its fields: label \(string\): What it counts; count \(number\)\./,
		);
	});
});
