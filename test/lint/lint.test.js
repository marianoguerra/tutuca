import assert from "node:assert/strict";
import test from "node:test";
import { lint, lintToConsole } from "../../src/lint/index.js";
import {
	$if,
	component,
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
	scope,
	send,
	seqItem,
	sourceKey,
	t,
	targetValue,
} from "../../src/tutuca.js";

// Registration only needs a root node to add delegated listeners to.
const lintOf = (specs) => {
	const host = new Host({ document: null, rootNode: { addEventListener() {} } });
	host.scope.register(specs);
	return lint(host.registrations, host.componentNames).map(
		({ level, code, path }) => `${level} ${code} ${path}`,
	);
};

test("a component using every helper correctly is clean", () => {
	const Item = component({
		name: "Item",
		fields: (t) => ({ label: t.string() }),
		views: { main: field("label"), row: h("li", {}, field("label")) },
	});
	const Page = component({
		name: "Page",
		fields: (t) => ({ items: t.array(), selected: t.number(), query: t.string() }),
		loops: {
			rows: { enrich: ({ value }) => ({ label: value.label }), view: "row" },
		},
		scopes: { stats: { bind: () => ({ count: 1 }) } },
		provides: {
			list(pb) {
				pb.field("items");
			},
		},
		view: h(
			"div",
			{ class: $if(field("query"), "a", "b") },
			h("input", { "@on.input": send("setQuery", targetValue()) }),
			each(
				field("items"),
				h("button", { "@on.click": send("pick", sourceKey()) }, lookupBind("label")),
				"rows",
			),
			each(field("items"), renderIt("row")),
			renderEach(field("items"), "rows"),
			render(seqItem("items", "selected")),
			scope("stats", lookupBind("count")),
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
			scopes: { s: {} },
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
		{ name: "NotSend", view: h("button", { "@on.click": "inc" }) },
		["error event-needs-send NotSend.main > button > [@on.click]"],
	],
	[
		"a send in a plain attribute",
		{ name: "SendAttr", view: h("button", { title: send("inc") }), on: { inc() {} } },
		["error send-not-event SendAttr.main > button > [title] > send(inc)"],
	],
	[
		"an event naming a missing or inherited handler",
		{ name: "NoHandler", view: h("p", {}, h("button", { "@on.click": send("toString") })) },
		["error unknown-handler NoHandler.main > p > button > [@on.click]"],
	],
	[
		"an event type that is not lower-case",
		{ name: "Camel", view: h("button", { "@on.Click": send("inc") }), on: { inc() {} } },
		["warning unknown-event Camel.main > button"],
	],
	[
		"unknown and inherited loop and scope names",
		{
			name: "Names",
			fields: (t) => ({ items: t.array() }),
			view: h("div", {}, each(field("items"), "x", "nope"), scope("toString", "x")),
		},
		[
			"error unknown-loop Names.main > div > each(nope)",
			"error unknown-scope Names.main > div > scope(toString)",
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
			fields: (t) => ({ name: t.string() }),
			view: h("button", { "@on.click": send("set", field("name"), h("i", {})) }),
			on: { set() {} },
		},
		[
			"error state-in-action Reads.main > button > [@on.click] > send(set) > field(name)",
			"error state-in-action Reads.main > button > [@on.click] > send(set) > i",
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
			fields: (t) => ({ items: t.array() }),
			view: h(
				"div",
				{ "@on.click": send("pick", sourceKey()) },
				sourceKey(),
				each(field("items"), h("i", {}, sourceKey())),
			),
			on: { pick() {} },
		},
		[
			"error source-key-outside-action Source.main > div > sourceKey",
			"error source-key-outside-action Source.main > div > each() > i > sourceKey",
			"error source-key-outside-loop Source.main > div > [@on.click] > send(pick) > sourceKey",
		],
	],
	[
		"renderIt and item binds outside a loop body",
		{
			name: "OutsideLoop",
			fields: (t) => ({ items: t.array() }),
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
			fields: (t) => ({ items: t.array() }),
			view: each(
				field("items"),
				h("button", { "@on.click": send("pick", lookupBind("value"), lookupBind("key")) }),
			),
			on: { pick() {} },
		},
		[
			"error bind-in-action ActionBinds.main > each() > button > [@on.click] > send(pick) > lookupBind",
			"error bind-in-action ActionBinds.main > each() > button > [@on.click] > send(pick) > lookupBind",
		],
	],
	[
		"a named bind with no scope or enriching loop",
		{
			name: "Binds",
			fields: (t) => ({ items: t.array() }),
			loops: { plain: {} },
			view: h("div", {}, lookupBind("count"), each(field("items"), lookupBind("label"), "plain")),
		},
		[
			"warning unknown-bind Binds.main > div > lookupBind",
			"warning unknown-bind Binds.main > div > each(plain) > lookupBind",
		],
	],
	[
		"a scope does not reach into a loop body",
		{
			name: "ScopeLoop",
			fields: (t) => ({ items: t.array() }),
			scopes: { s: { bind: () => ({ count: 1 }) } },
			view: scope("s", each(field("items"), lookupBind("count"))),
		},
		["warning unknown-bind ScopeLoop.main > scope(s) > each() > lookupBind"],
	],
	[
		"view names no registration declares",
		{
			name: "Views",
			fields: (t) => ({ child: t.option(t.component()) }),
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
			fields: (t) => ({ child: t.option(t.component()) }),
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
		fields: (t) => ({ declared: t.number(1), label: t.string() }),
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
		fields: (t) => ({
			item: t.component("Item"),
			alias: t.component("Row"),
			any: t.component(),
			missing: t.option(t.component("Missing")),
			items: t.array(t.component("Gone")),
		}),
		view: "page",
	});
	assert.deepEqual(lintOf({ Item, Row: Item, Page }), [
		"warning unknown-component Page",
		"warning unknown-component Page",
	]);
	const host = new Host({ document: null, rootNode: { addEventListener() {} } });
	host.scope.register({ Page });
	assert.deepEqual(lint(host.registrations), [], "without names the check is skipped");
});

test("lintToConsole groups issues by component and logs by level", () => {
	const Mixed = component({
		name: "Mixed",
		view: h("button", { "@on.click": send("missing") }, lookupBind("count")),
	});
	const host = new Host({ document: null, rootNode: { addEventListener() {} } });
	host.scope.register({ Mixed });
	const calls = [];
	const out = Object.fromEntries(
		["info", "group", "groupCollapsed", "groupEnd", "error", "warn"].map((name) => [
			name,
			(...args) => calls.push([name, args[0]]),
		]),
	);
	const issues = lintToConsole(host.registrations, out);
	assert.equal(issues.length, 2);
	assert.deepEqual(calls, [
		["group", "tutuca lint: 1 errors, 1 warnings"],
		["groupCollapsed", "Mixed (2)"],
		[
			"warn",
			'unknown-bind Mixed.main > button > lookupBind: no enclosing scope or enriching loop binds "count"',
		],
		["error", "unknown-handler Mixed.main > button > [@on.click]: no own handler on.missing"],
		["groupEnd", undefined],
		["groupEnd", undefined],
	]);
	const clean = [];
	lintToConsole([], { info: (msg) => clean.push(msg) });
	assert.deepEqual(clean, ["tutuca lint: clean"]);
});

test("lint reports defaults of the wrong kind, bad index targets and every unknown candidate", () => {
	const Item = component({ name: "Item", view: "item" });
	const Bad = component({
		name: "Bad",
		fields: (t) => ({
			count: t.number().default("x"),
			level: t.number().min(1).default(0),
			mode: t.enum("a", "b").default("c"),
			label: t.string(),
			selected: t.index("label"),
			pick: t.option(t.component(["Item", "Nope"])),
			fresh: t.string(() => "computed"),
		}),
		view: "bad",
	});
	assert.deepEqual(lintOf({ Item, Bad }), [
		"error bad-default Bad",
		"error bad-default Bad",
		"error bad-index Bad",
		"warning unknown-component Bad",
	]);
});

test("lint checks message specs and the sends that target them", () => {
	const Form = component({
		name: "Form",
		fields: (t) => ({ n: t.number() }),
		view: h(
			"div",
			{},
			h("p", { "@on.click": send("set", 1) }, "ok"),
			h("i", { "@on.click": send("set") }, "arity"),
			h("b", { "@on.click": send("set", "x") }, "type"),
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
		"error send-arity Form.main > div > i > [@on.click]",
		"error send-arg-type Form.main > div > b > [@on.click]",
	]);
});
