import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { jsonComponents } from "../../components/json/index.js";
import { todoAppArb } from "../../components/todo/fixtures.js";
import { todoComponents } from "../../components/todo/index.js";
import {
	arbitraries,
	Driver,
	eventCommands,
	messageCommands,
	runCommands,
} from "../../src/test/pbt.js";
import {
	$if,
	component,
	DispatchPath,
	Frame,
	field,
	h,
	render,
	renderEach,
	send,
	seqItem,
	t,
} from "../../src/tutuca.js";
import { document, scopeWith, testGenericProperties } from "../helpers.js";

const RUNS = { numRuns: 50 };

// Tabs keep exactly the selected tab selected: an invariant the tests below break on purpose.
const Tabs = component({
	name: "Tabs",
	fields: (t) => ({
		tabs: t.array(t.component("Tab")).len(1),
		selectedTabIndex: t.index("tabs"),
	}),
	invariants: {
		oneSelected() {
			return this.tabs.every((tab, i) => tab.isSelected === (i === this.selectedTabIndex));
		},
	},
	loops: { tabs: { view: "tab" } },
	view: h(
		"div",
		{},
		renderEach(field("tabs"), "tabs"),
		render(seqItem("tabs", "selectedTabIndex")),
	),
	on: {
		tabSelected: {
			args: [],
			sourceKey: t.index("tabs"),
			post: (_prev, next, _args, { sourceKey }) => next.selectedTabIndex === sourceKey,
			run(draft, _args, ctx) {
				draft.tabs[this.selectedTabIndex].isSelected = false;
				draft.tabs[ctx.sourceKey].isSelected = true;
				draft.selectedTabIndex = ctx.sourceKey;
				ctx.stopNext();
			},
		},
	},
});

const Tab = component({
	name: "Tab",
	fields: (t) => ({ label: t.string(), isSelected: t.boolean() }),
	views: {
		main: h("p", {}, field("label")),
		tab: h(
			"button",
			{ class: $if(field("isSelected"), "btn btn-success", "btn"), "@on.click": send("selected") },
			field("label"),
		),
	},
	on: {
		selected: {
			args: [],
			emits: { notify: ["tabSelected"] },
			run(draft, _args, ctx) {
				draft.isSelected = true;
				ctx.notify("tabSelected");
			},
		},
	},
});

const tabComponents = { Tabs, Tab };

// Tabs keep exactly the selected tab selected, too rare to reach by filtering.
const tabsArb = (A, depth) =>
	A.fc
		.array(A.instance("Tab", depth + 1), { minLength: 1, maxLength: 4 })
		.chain((tabs) => A.fc.nat({ max: tabs.length - 1 }).map((selected) => [tabs, selected]))
		.map(([tabs, selected]) => {
			const fixed = tabs.map((tab, i) =>
				A.scope.make("Tab", { ...tab, isSelected: i === selected }),
			);
			return A.scope.make("Tabs", { tabs: fixed, selectedTabIndex: selected });
		});

const setup = (components = tabComponents, overrides = { Tabs: tabsArb }) => {
	return arbitraries({ fc, scope: scopeWith(components), overrides });
};

testGenericProperties(tabComponents, { overrides: { Tabs: tabsArb }, ...RUNS });

test("message sequences keep the todo app valid", () => {
	const A = setup(todoComponents, { TodoApp: todoAppArb });
	const include = [
		"TodoApp.openView",
		"TodoApp.setSearch",
		"TodoApp.clearCompleted",
		"TodoTask.toggle",
		"TodoTask.setTitle",
		"TodoTask.remove",
	];
	fc.assert(
		fc.property(A.instance("TodoApp"), messageCommands(A, { include }), (app, cmds) =>
			runCommands(A, app, cmds),
		),
		RUNS,
	);
});

test("message sequences keep one tab selected", () => {
	const A = setup();
	const include = ["Tab.selected", "Tabs.tabSelected"];
	fc.assert(
		fc.property(A.instance("Tabs"), messageCommands(A, { include }), (tabs, cmds) =>
			runCommands(A, tabs, cmds),
		),
		RUNS,
	);
});

test("event sequences keep the state valid and the patched DOM equal to a fresh render", () => {
	const A = setup(jsonComponents, {});
	fc.assert(
		fc.property(A.instance("JsonEditor"), eventCommands(A), (editor, cmds) =>
			runCommands(A, editor, cmds, { document }),
		),
		{ numRuns: 25 },
	);
});

const failure = (fn) => {
	try {
		fn();
	} catch (error) {
		return `${error.message}\n${error.cause?.message ?? ""}`;
	}
	assert.fail("expected a counterexample");
};

test("a handler that breaks the schema is found with a minimal sequence", () => {
	const Item = component({
		name: "Item",
		fields: (t) => ({ count: t.number() }),
		view: h("button", { "@on.click": send("inc") }, field("count")),
		on: {
			inc(draft) {
				draft.count = draft.count > 0 ? "many" : draft.count + 1;
			},
		},
	});
	const A = setup({ Item }, {});
	const message = failure(() =>
		fc.assert(
			fc.property(A.instance(Item), messageCommands(A), (item, cmds) => runCommands(A, item, cmds)),
			{ seed: 1 },
		),
	);
	assert.match(message, /Item at ·\.inc\(\) broke:\n {2}stateInvalid: Item count invalid/);
});

test("a tab switch that forgets the old tab breaks the invariant", () => {
	const tabSelected = Tabs.on.tabSelected;
	const BuggyTabs = component({
		name: "Tabs",
		fields: Tabs.fields,
		invariants: Tabs.invariants,
		views: Tabs.views,
		loops: Tabs.loops,
		on: {
			tabSelected: {
				...tabSelected,
				run(draft, _args, ctx) {
					draft.tabs[ctx.sourceKey].isSelected = true;
					draft.selectedTabIndex = ctx.sourceKey;
					ctx.stopNext();
				},
			},
		},
	});
	const A = setup({ Tabs: BuggyTabs, Tab }, { Tabs: tabsArb });
	const include = ["Tab.selected"];
	const message = failure(() =>
		fc.assert(
			fc.property(A.instance("Tabs"), messageCommands(A, { include }), (tabs, cmds) =>
				runCommands(A, tabs, cmds),
			),
		),
	);
	assert.match(message, /Tabs · oneSelected|invariant:oneSelected/);
});

test("a post condition that doesn't hold is reported with the message", () => {
	const Counter = component({
		name: "Counter",
		fields: (t) => ({ count: t.number().int().min(0).max(1000) }),
		view: "counter",
		on: {
			add: {
				args: [t.number().int().min(0).max(10)],
				post: (prev, next, [n]) => next.count === prev.count + n,
				run(draft, [n]) {
					draft.count = Math.min(draft.count + n, 1000);
				},
			},
		},
	});
	const A = setup({ Counter }, {});
	const message = failure(() =>
		fc.assert(
			fc.property(A.instance(Counter), messageCommands(A), (c, cmds) => runCommands(A, c, cmds)),
		),
	);
	assert.match(message, /messageInvalid add: post/);
});

test("the driver runs messages headless and records what they report", () => {
	const A = setup();
	const [tabs] = fc.sample(A.instance("Tabs"), { numRuns: 1, seed: 3 });
	const driver = new Driver({ root: tabs });
	assert.deepEqual(driver.problems, []);
	const last = tabs.tabs.length - 1;
	driver.send(new DispatchPath([new Frame(["tabs"], last, null, true)]), "selected");
	assert.equal(driver.state.selectedTabIndex, last);
	assert.equal(driver.state.tabs[last].isSelected, true);
	assert.deepEqual(driver.problems, []);
	driver.send(new DispatchPath(), "tabSelected", [], [new Frame(["tabs"], 99, null, true)]);
	assert.deepEqual(
		driver.problems.map((p) => p.type),
		["taskFailed"],
	);
});
