// tutuca/pure's define.js: a component module's source checked against the scope it would go
// in (every error and warning with where it is), registered there, and a name defined again
// moving the live instances onto the new definition with their state.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	checkComponentSource,
	checkReportText,
	defineComponentSource,
	defineReportText,
	listScopes,
	removedText,
	removeScope,
	scopesText,
	unregisterComponent,
} from "../../src/pure/index.js";
import { hydrate } from "../../src/sync/codec.js";
import { idOf } from "../../src/tree/identity.js";
import { component, Scope, specOf, t } from "../../src/tutuca.js";

const lines = (...text) => text.join("\n");
const CARD = lines(
	'import { button, div, field, send, span } from "tutuca/view";',
	"export type Card = { title: string; count: number };",
	"export const Card = {",
	'	defaults: { title: "card", count: 0 },',
	"	on: { inc: { run(next) { next.count += 1; } } },",
	'	view: div(span(field("title")), button({ "on:click": send("inc") }, field("count"))),',
	"};",
);
const errorsOf = (report) => report.diagnostics.filter((d) => d.severity === "error");

describe("checkComponentSource", () => {
	test("a module that checks: what it defines, nothing registered", () => {
		const scope = new Scope();
		const report = checkComponentSource(CARD, scope);
		assert.deepEqual(report, {
			ok: true,
			components: ["Card"],
			agents: {},
			examples: [],
			replaces: [],
			shadows: [],
			diagnostics: [],
		});
		assert.equal(scope.lookupSpec("Card"), null);
		assert.equal(checkReportText(report), "It checks: defines Card.");
	});

	test("a parse error: where it is, as a line and a column, with its line of source", () => {
		const report = checkComponentSource(CARD.replace("count: 0 }", "count: 0 ;"), new Scope());
		assert.equal(report.ok, false);
		const [d] = report.diagnostics;
		assert.equal(d.severity, "error");
		assert.equal(d.stage, "parse");
		assert.equal(d.code, "syntax-error");
		assert.equal(d.line, 4);
		assert.equal(d.column, 38);
		assert.equal(d.sourceLine, '	defaults: { title: "card", count: 0 ;,');
		assert.match(checkReportText(report), /--> line 4, column 38/);
	});

	test("a check error: what to do instead", () => {
		const report = checkComponentSource(
			CARD.replace("next.count += 1", "this.count += 1"),
			new Scope(),
		);
		const [d] = errorsOf(report);
		assert.equal(d.code, "immutable-target");
		assert.equal(d.line, 5);
		assert.equal(d.help, "this is read-only: change next instead");
		assert.match(checkReportText(report), /= help: this is read-only: change next instead/);
	});

	test("a lint warning doesn't stop it: the component and view it's in", () => {
		const report = checkComponentSource(
			CARD.replace('span(field("title"))', 'span(field("titel"))'),
			new Scope(),
		);
		assert.equal(report.ok, true);
		const [d] = report.diagnostics;
		assert.equal(d.severity, "warning");
		assert.equal(d.code, "unknown-field");
		assert.equal(d.component, "Card");
		assert.equal(d.view, "main");
		assert.equal(d.line, null);
		assert.match(checkReportText(report), /warning\[unknown-field\].*\n {2}--> in Card, view main/);
	});

	test("what doesn't register where it goes: an interface it says it implements isn't there", () => {
		const source = CARD.replace(
			"export const Card = {",
			'export const Card = {\n\timplements: ["Missing"],',
		);
		const report = checkComponentSource(source, new Scope());
		assert.equal(report.ok, false);
		assert.ok(
			report.diagnostics.some((d) => d.stage === "register" && /Missing/.test(d.message)),
			JSON.stringify(report.diagnostics),
		);
	});

	test("a module with no component says so", () => {
		const report = checkComponentSource("export const x = 1;", new Scope());
		assert.equal(report.ok, false);
		assert.equal(report.diagnostics[0].code, "no-components");
	});

	test("a name registered there it replaces, one registered above it shadows", () => {
		const scope = new Scope();
		defineComponentSource(CARD, scope);
		assert.deepEqual(checkComponentSource(CARD, scope).replaces, ["Card"]);
		const child = scope.enter("inner");
		const report = checkComponentSource(CARD, child);
		assert.deepEqual([report.replaces, report.shadows], [[], ["Card"]]);
		assert.match(checkReportText(report), /Card here would be its own, over the Card above/);
	});
});

describe("defineComponentSource", () => {
	test("a component synced from a peer that defined it becomes the real one once it's defined here", () => {
		const scope = new Scope();
		const Holder = component({
			name: "Holder",
			fields: { content: t.option(t.component()) },
			view: "<div></div>",
		});
		scope.register({ Holder });
		const root = hydrate({ $: "Holder", content: { $: "Card", title: "synced", count: 3 } }, scope);
		assert.equal(specOf(root.content).name, "UnknownComponent");
		const answer = defineComponentSource(CARD, scope, root);
		assert.equal(answer.ok, true);
		assert.equal(specOf(answer.root.content), scope.lookupSpec("Card"));
		assert.equal(answer.root.content.title, "synced");
		assert.equal(answer.root.content.count, 3);
	});

	test("registers in the scope given, which makes it by name", () => {
		const scope = new Scope();
		const answer = defineComponentSource(CARD, scope);
		assert.equal(answer.ok, true);
		assert.deepEqual(answer.registered, ["Card"]);
		assert.equal(answer.root, null);
		assert.equal(scope.make("Card", {}).title, "card");
		assert.equal(defineReportText(answer), "Defined Card.");
	});

	test("refuses a module that doesn't check, registering nothing", () => {
		const scope = new Scope();
		const answer = defineComponentSource(CARD.replace("next.count", "this.count"), scope);
		assert.equal(answer.ok, false);
		assert.equal(scope.lookupSpec("Card"), null);
		assert.match(defineReportText(answer), /^Nothing was defined\.\n1 error, 0 warnings/);
	});

	test("a name defined again: the instances move onto it, keeping their state and identity", () => {
		const scope = new Scope();
		const Holder = component({ name: "Holder", fields: { items: t.array(t.component()) } });
		scope.register({ Holder });
		defineComponentSource(CARD, scope);
		const root = scope.make("Holder", { items: [scope.make("Card", { count: 5 })] });
		const old = root.items[0];
		const card2 = CARD.replace("count: number }", "count: number; done: boolean }").replace(
			"count: 0 }",
			"count: 0, done: true }",
		);
		const answer = defineComponentSource(card2, scope, root);
		assert.equal(answer.ok, true);
		assert.deepEqual(answer.replaced, ["Card"]);
		const card = answer.root.items[0];
		assert.notEqual(specOf(card), specOf(old));
		assert.equal(specOf(card), scope.lookupSpec("Card"));
		assert.equal(card.count, 5);
		assert.equal(card.done, true);
		assert.equal(idOf(card), idOf(old));
		assert.equal(idOf(answer.root), idOf(root));
		assert.deepEqual(answer.added, [["items", 0, "done"]]);
		assert.match(
			defineReportText(answer),
			/Gave Card a new definition.*\n {2}\.items\[0\]\.done added/,
		);
	});

	test("a name defined again over a state that can't be carried leaves the old definition", () => {
		const scope = new Scope();
		const Holder = component({ name: "Holder", fields: { items: t.array(t.component()) } });
		scope.register({ Holder });
		defineComponentSource(CARD, scope);
		const before = scope.lookupSpec("Card");
		const root = scope.make("Holder", { items: [scope.make("Card", {})] });
		// A component in the state that's no longer registered: the state can't be written.
		const Gone = component({ name: "Gone", fields: {} });
		scope.register({ Gone });
		const withGone = scope.make("Holder", { items: [...root.items, scope.make("Gone", {})] });
		delete scope.specs.Gone;
		const answer = defineComponentSource(CARD.replace('"card"', '"other"'), scope, withGone);
		assert.equal(answer.ok, false);
		assert.equal(answer.diagnostics.at(-1).stage, "carry");
		assert.equal(scope.lookupSpec("Card"), before);
	});
});

describe("scopes below a scope", () => {
	const setup = () => {
		const scope = new Scope();
		const Holder = component({ name: "Holder", fields: { items: t.array(t.component()) } });
		scope.register({ Holder });
		const scratch = scope.enter("scratch");
		defineComponentSource(CARD, scratch);
		return { scope, scratch };
	};

	test("one registered below is made by its path, and isn't seen from above", () => {
		const { scope, scratch } = setup();
		assert.equal(scope.lookupSpec("Card"), null);
		const card = scope.make("scratch/Card", { count: 2 });
		assert.equal(specOf(card), scratch.specs.Card);
		assert.equal(scope.tryMake("scratch/Nope", {}).err.error, "Component Nope is not registered");
		assert.match(scope.tryMake("nowhere/Card", {}).err.error, /No scope nowhere/);
	});

	test("listScopes: each scope below, its components and how many are in use", () => {
		const { scope } = setup();
		const root = scope.make("Holder", { items: [scope.make("scratch/Card", {})] });
		assert.deepEqual(listScopes(scope, root), [
			{ name: "scratch", path: "scratch", components: [{ name: "Card", live: 1 }] },
		]);
		assert.equal(scopesText(listScopes(scope, root)), "scratch: Card (1 in use)");
	});

	test("a component or a scope in use isn't removed, and says where it's used", () => {
		const { scope, scratch } = setup();
		const root = scope.make("Holder", { items: [scope.make("scratch/Card", {})] });
		const kept = unregisterComponent(scope, "Card", "scratch", root);
		assert.deepEqual(kept.inUse, [["items", 0]]);
		assert.equal(
			removedText(kept),
			"Can't remove Card from scratch: it's in use at\n  .items[0]\nRemove those first.",
		);
		assert.equal(removeScope(scope, "scratch", root).ok, false);
		assert.ok(scratch.specs.Card);
		assert.ok(scope.children.scratch);
	});

	test("unused, a component and then its scope are removed", () => {
		const { scope } = setup();
		const root = scope.make("Holder", { items: [] });
		assert.equal(
			removedText(unregisterComponent(scope, "Card", "scratch", root)),
			"Removed Card from scratch.",
		);
		assert.equal(scope.children.scratch.specs.Card, undefined);
		assert.equal(removedText(removeScope(scope, "scratch", root)), "Removed scope scratch.");
		assert.equal(scope.children.scratch, undefined);
		assert.match(removedText(removeScope(scope, "scratch", root)), /there's no scope scratch here/);
	});

	test("defined below a name above, it shadows it: the one above is untouched", () => {
		const scope = new Scope();
		defineComponentSource(CARD, scope);
		const above = scope.lookupSpec("Card");
		const answer = defineComponentSource(CARD.replace('"card"', '"below"'), scope.enter("scratch"));
		assert.deepEqual([answer.replaced, answer.shadowed, answer.scope], [[], ["Card"], "scratch"]);
		assert.equal(
			defineReportText(answer),
			"Defined Card in scope scratch, over the Card above it.",
		);
		assert.equal(scope.lookupSpec("Card"), above);
	});
});

describe("a module's examples", () => {
	const TALLY = (examples, run = "next.count += n;") =>
		lines(
			'import { div, field } from "tutuca/view";',
			"export type Tally = { count: number; readonly twice: number };",
			"export const Tally = {",
			"	defaults: { count: 0 },",
			"	constraints: { count: { max: 10 } },",
			`	on: { add: { run(next, [n]: [number]) { ${run} } } },`,
			"	queries: { twice() { return this.count * 2; } },",
			'	view: div(field("count")),',
			`	examples: ${examples},`,
			"};",
		);
	const run = (examples, body) => checkComponentSource(TALLY(examples, body), new Scope());
	const exampleErrors = (r) => r.diagnostics.filter((d) => d.code === "example");

	test("that pass: the report says so, and nothing's wrong", () => {
		const r = run(
			'{ adds: { start: { count: 1 }, steps: [{ send: "add", args: [2] }, { expect: { count: 3, twice: 6 } }] } }',
		);
		assert.equal(r.ok, true);
		assert.deepEqual(r.examples, [{ component: "Tally", name: "adds", ok: true }]);
		assert.match(checkReportText(r), /Examples: 1 of 1 pass \(✓ Tally\.adds\)\./);
	});

	test("that get something else: an error at the example, with the step, expected and got", () => {
		const r = run(
			'{ adds: { steps: [{ send: "add", args: [1] }, { send: "add", args: [2] }, { expect: { count: 3 } }] } }',
			"next.count = next.count * 5 + n;",
		);
		assert.equal(r.ok, false);
		const [d] = exampleErrors(r);
		assert.equal(d.message, "Tally's example adds, step 3: expected count to be 3, got 7");
		assert.equal(d.sourceLine.trim().startsWith("examples: { adds:"), true);
		assert.equal(d.component, "Tally");
	});

	test("a send that breaks a contract, a key that isn't there and a start that can't be", () => {
		const [broke] = exampleErrors(
			run('{ over: { steps: [{ send: "add", args: [20] }, { expect: { count: 20 } }] } }'),
		);
		assert.match(broke.message, /^Tally's example over, step 1: sending add failed: /);
		// What an expect names is typed: one that isn't there doesn't compile.
		const missing = run("{ q: { steps: [{ expect: { thrice: 0 } }] } }");
		assert.deepEqual(
			missing.diagnostics.map((d) => d.code),
			["excess-property"],
		);
		const [start] = exampleErrors(run("{ s: { start: { count: 99 }, steps: [] } }"));
		assert.match(
			start.message,
			/^Tally's example s: Tally can't start from its start: count 99 isn't one its type allows \(it was made 0\)/,
		);
	});
});
