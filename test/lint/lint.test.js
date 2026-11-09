import assert from "node:assert/strict";
import test from "node:test";
import { lint, lintScope, registeredIn } from "../../src/lint/index.js";
import { CLASSES_META } from "../../src/meta/index.js";
import {
	$if,
	component,
	dragKey,
	each,
	field,
	Host,
	h,
	lookupBind,
	provided,
	pushView,
	render,
	renderEach,
	renderIt,
	send,
	seqItem,
	sourceKey,
	t,
	targetValue,
	withBinds,
} from "../../src/tutuca.js";

// Registration only needs a root node to add delegated listeners to.
const lintOf = (specs) => {
	const host = new Host({ document: null, rootNode: { addEventListener() {} } });
	host.scope.register(specs);
	return lintScope(host.scope).map(({ level, code, path }) => `${level} ${code} ${path}`);
};

test("a component using every helper correctly is clean", () => {
	const Item = component({
		name: "Item",
		fields: { label: t.string() },
		views: { main: field("label"), row: h("li", {}, field("label")) },
	});
	const Page = component({
		name: "Page",
		fields: { items: t.array(), selected: t.number(), query: t.string() },
		loops: {
			rows: { enrich: ({ value }) => ({ label: value.label }), view: "row" },
		},
		binds: { stats: () => ({ count: 1 }) },
		provides: {
			list(pb) {
				pb.field("items");
			},
		},
		view: h(
			"div",
			{ class: $if(field("query"), "a", "b") },
			h("input", { "on:input": send("setQuery", targetValue()) }),
			each(
				field("items"),
				h("button", { "on:click": send("pick", sourceKey()) }, lookupBind("label")),
				"rows",
			),
			each(field("items"), renderIt("row")),
			renderEach(field("items"), "rows"),
			render(seqItem("items", "selected")),
			withBinds("stats", lookupBind("count")),
			pushView("row", renderEach(provided("list"))),
		),
		on: { setQuery() {}, pick() {} },
	});
	assert.deepEqual(lintOf({ Item, Page }), []);
});

// component() rejects a missing main view itself, so lint has no no-main-view check.
test("a component without a main view is rejected before lint", () => {
	assert.throws(
		() => component({ name: "NoMain", views: { compact: "x" } }),
		/Component NoMain has no main view/,
	);
});

const cases = [
	[
		// component() copies each section into an object, so only entry shapes are left;
		// a non-object section such as `provides: []` can no longer be reported.
		"section entries with the wrong shape",
		{
			name: "Shapes",
			view: "x",
			on: { a: 1 },
			loops: { l: { filter: true, view: 3 } },
			binds: { s: {} },
			provides: { p: 1 },
		},
		[
			"error section-shape Shapes",
			"error section-shape Shapes",
			"error section-shape Shapes",
			"error section-shape Shapes",
			"error loop-view-type Shapes",
		],
	],
	[
		"a loop with both iter and filter",
		{ name: "Both", view: "x", loops: { l: { iter() {}, filter() {} } } },
		["warning filter-ignored Both"],
	],
	[
		"an event bound to a non-send value",
		{ name: "NotSend", view: h("button", { "on:click": "inc" }) },
		["error event-needs-send NotSend.main > button > [on:click]"],
	],
	[
		"a send in a plain attribute",
		{ name: "SendAttr", view: h("button", { title: send("inc") }), on: { inc() {} } },
		["error send-not-event SendAttr.main > button > [title] > send(inc)"],
	],
	[
		"an event naming a missing or inherited handler",
		{ name: "NoHandler", view: h("p", {}, h("button", { "on:click": send("toString") })) },
		["error unknown-handler NoHandler.main > p > button > [on:click]"],
	],
	[
		"an event type that is not lower-case",
		{ name: "Camel", view: h("button", { "on:Click": send("inc") }), on: { inc() {} } },
		["warning unknown-event Camel.main > button"],
	],
	[
		"a kebab-case custom event type",
		{ name: "Kebab", view: h("div", { "on:emoji-click": send("inc") }), on: { inc() {} } },
		[],
	],
	[
		"unknown and inherited loop and binds names",
		{
			name: "Names",
			fields: { items: t.array() },
			view: h("div", {}, each(field("items"), "x", "nope"), withBinds("toString", "x")),
		},
		[
			"error unknown-loop Names.main > div > each(nope)",
			"error unknown-binds Names.main > div > withBinds(toString)",
		],
	],
	[
		"a constant as a render or each source",
		{ name: "Sources", view: h("div", {}, render("child"), each([1, 2], "x")) },
		[
			"error not-a-source Sources.main > div > render",
			"error not-a-source Sources.main > div > each()",
		],
	],
	[
		"state read in send arguments",
		{
			name: "Reads",
			fields: { name: t.string() },
			view: h("button", { "on:click": send("set", field("name"), h("i", {})) }),
			on: { set() {} },
		},
		[
			"error state-in-action Reads.main > button > [on:click] > send(set) > field(name)",
			"error state-in-action Reads.main > button > [on:click] > send(set) > i",
		],
	],
	[
		"targetValue outside send arguments",
		{ name: "Target", view: h("p", {}, targetValue()) },
		["error target-outside-action Target.main > p > targetValue"],
	],
	[
		"sourceKey outside send arguments or outside a loop body",
		{
			name: "Source",
			fields: { items: t.array() },
			view: h(
				"div",
				{ "on:click": send("pick", sourceKey()) },
				sourceKey(),
				each(field("items"), h("i", {}, sourceKey())),
			),
			on: { pick() {} },
		},
		[
			"error source-key-outside-action Source.main > div > sourceKey",
			"error source-key-outside-action Source.main > div > each() > i > sourceKey",
			"error source-key-outside-loop Source.main > div > [on:click] > send(pick) > sourceKey",
		],
	],
	[
		"dragKey outside send arguments or outside drag events",
		{
			name: "DragOutside",
			view: h(
				"div",
				{ "on:click": send("pick", dragKey()), "on:drop": send("pick", dragKey()) },
				dragKey(),
			),
			on: { pick() {} },
		},
		[
			"error drag-key-outside-action DragOutside.main > div > dragKey",
			"error drag-key-outside-drag-event DragOutside.main > div > [on:click] > send(pick) > dragKey",
		],
	],
	[
		"renderIt and item binds outside a loop body",
		{
			name: "OutsideLoop",
			fields: { items: t.array() },
			view: h("div", {}, renderIt(), lookupBind("key"), each(lookupBind("value"), "x")),
		},
		[
			"error render-it-outside-loop OutsideLoop.main > div > renderIt",
			"error bind-outside-loop OutsideLoop.main > div > lookupBind",
			"error not-a-source OutsideLoop.main > div > each()",
			"error bind-outside-loop OutsideLoop.main > div > each() > lookupBind",
		],
	],
	[
		"binds in send arguments, the key included",
		{
			name: "ActionBinds",
			fields: { items: t.array() },
			view: each(
				field("items"),
				h("button", { "on:click": send("pick", lookupBind("value"), lookupBind("key")) }),
			),
			on: { pick() {} },
		},
		[
			"error bind-in-action ActionBinds.main > each() > button > [on:click] > send(pick) > lookupBind",
			"error bind-in-action ActionBinds.main > each() > button > [on:click] > send(pick) > lookupBind",
		],
	],
	[
		"a named bind with no withBinds or enriching loop",
		{
			name: "Binds",
			fields: { items: t.array() },
			loops: { plain: {} },
			view: h("div", {}, lookupBind("count"), each(field("items"), lookupBind("label"), "plain")),
		},
		[
			"warning unknown-bind Binds.main > div > lookupBind",
			"warning unknown-bind Binds.main > div > each(plain) > lookupBind",
		],
	],
	[
		"a withBinds does not reach into a loop body",
		{
			name: "BindsLoop",
			fields: { items: t.array() },
			binds: { s: () => ({ count: 1 }) },
			view: withBinds("s", each(field("items"), lookupBind("count"))),
		},
		["warning unknown-bind BindsLoop.main > withBinds(s) > each() > lookupBind"],
	],
	[
		"view names no registration declares",
		{
			name: "Views",
			fields: { child: t.option(t.component()) },
			loops: { l: { view: "nope" } },
			view: h("div", {}, render(field("child"), "missing"), pushView("other", "x")),
		},
		[
			"warning unknown-view Views",
			"warning unknown-view Views.main > div > render",
			"warning unknown-view Views.main > div > pushView",
		],
	],
	[
		"a provided name no registration provides",
		{ name: "Prov", view: renderEach(provided("nope")) },
		["warning unknown-provided Prov.main > renderEach() > provided(nope)"],
	],
	[
		"a view rooted at render",
		{
			name: "Root",
			fields: { child: t.option(t.component()) },
			view: render(field("child")),
		},
		[],
	],
];
for (const [name, options, expected] of cases) {
	test(`lint reports ${name}`, () => {
		assert.deepEqual(lintOf({ [options.name]: component(options) }), expected);
	});
}

test("field names are checked against the schema and methods, outside loop bodies", () => {
	const Fields = component({
		name: "Fields",
		fields: { declared: t.number(1), label: t.string() },
		methods: {
			computed() {
				return this.declared;
			},
		},
		view: h(
			"div",
			{ title: field("label") },
			field("declared"),
			field("computed"),
			field("typo"),
			field("toString"),
			render(seqItem("declared", "nokey")),
			each(field("items"), field("anything")),
		),
	});
	const issues = lint(new Set([Fields]));
	assert.deepEqual(
		issues.map(({ level, code, path }) => `${level} ${code} ${path}`),
		[
			"warning unknown-field Fields.main > div > field(typo)",
			"warning unknown-field Fields.main > div > field(toString)",
			"warning unknown-field Fields.main > div > render > seqItem(declared, nokey)",
			"warning unknown-field Fields.main > div > each() > field(items)",
		],
	);
	assert.equal(issues[0].message, 'Fields has no field "typo"');
});

test("lint reports t.component names no scope registers", () => {
	const Item = component({ name: "Item", view: "item" });
	const Page = component({
		name: "Page",
		fields: {
			item: t.component("Item"),
			alias: t.component("Row"),
			any: t.component(),
			missing: t.option(t.component("Missing")),
			items: t.array(t.component("Gone")),
		},
		view: "page",
	});
	assert.deepEqual(lintOf({ Item, Row: Item, Page }), [
		"warning unknown-component Page",
		"warning unknown-component Page",
	]);
	const host = new Host({ document: null, rootNode: { addEventListener() {} } });
	host.scope.register({ Page });
	assert.deepEqual(lint(registeredIn(host.scope).specs), [], "without names the check is skipped");
});

test("lint reports defaults of the wrong kind, bad index targets and every unknown candidate", () => {
	const Item = component({ name: "Item", view: "item" });
	const Bad = component({
		name: "Bad",
		fields: {
			count: t.number().default("x"),
			level: t.number().min(1).default(0),
			mode: t.enum("a", "b").default("c"),
			label: t.string(),
			selected: t.index("label"),
			pick: t.option(t.component(["Item", "Nope"])),
			fresh: t.string(() => "computed"),
		},
		view: "bad",
	});
	assert.deepEqual(lintOf({ Item, Bad }), [
		"error bad-default Bad",
		"error bad-default Bad",
		"error bad-index Bad",
		"warning unknown-component Bad",
	]);
});

test("lint warns about handlers that read the clock or randomness themselves", () => {
	const Dice = component({
		name: "Dice",
		fields: { n: t.number(), at: t.number(), id: t.string() },
		on: {
			roll(next) {
				next.n = Math.random();
				next.at = Date.now();
			},
			rollWithCtx(next, _args, ctx) {
				next.n = ctx.random();
				next.at = ctx.now();
				next.id = ctx.uuid();
			},
		},
		view: "dice",
	});
	assert.deepEqual(lintOf({ Dice }), [
		"warning nondeterministic-call Dice",
		"warning nondeterministic-call Dice",
	]);
});

test("lint reserves the field name $ for synced components", () => {
	const Bad = component({ name: "Bad", fields: { $: t.string() }, view: "bad" });
	assert.deepEqual(lintOf({ Bad }), ["error reserved-field Bad"]);
});

test("lint checks message specs and the sends that target them", () => {
	const Form = component({
		name: "Form",
		fields: { n: t.number() },
		view: h(
			"div",
			{},
			h("p", { "on:click": send("set", 1) }, "ok"),
			h("i", { "on:click": send("set") }, "arity"),
			h("b", { "on:click": send("set", "x") }, "type"),
		),
		on: {
			set: { args: [t.number()], run() {} },
			noRun: { args: [] },
			badArgs: { args: ["number"], run() {} },
			badHooks: { pre: 1, sourceKey: "k", emits: { notify: "x" }, run() {} },
			notAnEntry: 42,
		},
	});
	assert.deepEqual(lintOf({ Form }), [
		"error section-shape Form",
		"error section-shape Form",
		"error section-shape Form",
		"error section-shape Form",
		"error section-shape Form",
		"error section-shape Form",
		"error send-arity Form.main > div > i > [on:click]",
		"error send-arg-type Form.main > div > b > [on:click]",
	]);
});

test("answers: a section of ok, error and unhandled handlers; an ask with none warns", () => {
	const Asker = component({
		name: "Asker",
		on: {
			go: {
				emits: { ask: ["load", "save"] },
				run(_next, _args, ctx) {
					ctx.ask("load");
					ctx.ask("save");
				},
			},
		},
		answers: {
			load: { ok() {}, done() {}, error: 3 },
			list: 1,
		},
		view: "asker",
	});
	assert.deepEqual(lintOf({ Asker }), [
		"error section-shape Asker",
		"error section-shape Asker",
		"error section-shape Asker",
		"warning unanswered-ask Asker",
	]);
});

test("pure messages get no ctx and emit nothing; queries read", async () => {
	const { $query, iface } = await import("../../src/tutuca.js");
	const Item = iface("Item", { queries: { label: {} } });
	const Row = component({
		name: "Row",
		implements: [Item],
		fields: { text: t.string() },
		on: {
			ok: {
				pure: true,
				args: [t.string()],
				run(next, [x]) {
					next.text = x;
				},
			},
			withCtx: { pure: true, run: (_next, _args, ctx) => ctx.notify("x", []) },
			emitting: { pure: true, emits: { notify: ["x"] }, run() {} },
		},
		queries: {
			get label() {
				return this.text;
			},
			has: {
				args: [t.string()],
				run(x) {
					return this.text.includes(x);
				},
			},
			writes() {
				this.text = "";
			},
		},
		view: h(
			"p",
			{},
			field("label"),
			$query("has", "a"),
			$query("has"),
			$query("label", 1),
			$query("nope"),
			$query("has", 3),
		),
	});
	const List = component({ name: "List", fields: { rows: t.array(t.component("Item")) } });
	assert.deepEqual(lintOf({ Row, List }), [
		"error pure-uses-ctx Row",
		"error pure-emits Row",
		"error query-mutates-this Row",
		"error query-arity Row.main > p > query(has)",
		"error query-arity Row.main > p > query(label)",
		"error unknown-query Row.main > p > query(nope)",
		"error query-arg-type Row.main > p > query(has)",
	]);
});

test("a getter in methods is a query", () => {
	const Box = component({
		name: "Box",
		fields: { w: t.number() },
		methods: {
			get area() {
				return this.w * this.w;
			},
			grow(next) {
				next.w += 1;
			},
		},
		view: field("area"),
	});
	assert.deepEqual(lintOf({ Box }), ["warning getter-in-methods Box"]);
});

test("a computed class needs the component's classes meta", () => {
	const Computed = component({
		name: "Computed",
		fields: { items: t.array(t.string()) },
		views: {
			main: h(
				"div",
				{ class: field("rootClass") },
				h("p", { class: $if(field("on"), "a", "b") }, "constant classes are seen"),
				each(field("items"), h("b", { class: lookupBind("chip") }), "chips"),
			),
		},
		queries: {
			get rootClass() {
				return "flex";
			},
			get on() {
				return true;
			},
		},
		loops: { chips: { enrich: (binds) => ({ ...binds, chip: "badge" }) } },
	});
	assert.deepEqual(lintOf([Computed]), [
		"warning undeclared-dynamic-class Computed.main > div > [class]",
		"warning undeclared-dynamic-class Computed.main > div > each(chips) > b > [class]",
	]);
	const Declared = component({
		name: "Declared",
		meta: { [CLASSES_META]: { classes: "flex badge" } },
		views: { main: h("div", { class: field("rootClass") }) },
		queries: {
			get rootClass() {
				return "flex";
			},
		},
	});
	assert.deepEqual(lintOf([Declared]), []);
});

test("a classes meta's classes is a string", () => {
	const Bad = component({
		name: "Bad",
		meta: { [CLASSES_META]: { classes: ["a", "b"], extra: 1 } },
		views: { main: h("div", { class: "a" }) },
	});
	assert.deepEqual(lintOf([Bad]), ["error classes-meta Bad", "error classes-meta Bad"]);
});
