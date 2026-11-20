// The paths tour (demos/paths): what each example's path tree reads as, which is what the tour
// is there to show, and that the tour reads an event's path as the host does.
import assert from "node:assert/strict";
import test from "node:test";
import { echoStep } from "../../components/agent/llm.js";
import { exampleOf, examples } from "../../demos/paths/examples.js";
import { start } from "../../demos/paths/main.js";
import { DWELLERS, MANNERS, MATERIALS, nameFrom, pickName } from "../../demos/paths/names.js";
import { PROFILES } from "../../demos/paths/profiles.js";
import { chainOf, pathKey, scanRegions } from "../../demos/paths/regions.js";
import { spanDetail, tracesOf } from "../../demos/paths/spans.js";
import { captureOf } from "../../demos/paths/trace.js";
import { trailComponents } from "../../demos/paths/trail.js";
import { rowsOf } from "../../demos/paths/tree.js";
import { agentProblems } from "../../src/meta/index.js";
import { pathTree, pathTreeText } from "../../src/tutuca.dev.js";
import { assertClean, mountDemo, settle } from "../helpers.js";

const mount = (example, options = {}) => mountDemo(start, { example, instant: true, ...options });
const treeText = (app) => pathTreeText(pathTree(app.state(), { siblings: 12 }));
const lines = (...text) => text.join("\n");

// The tree of each example as it starts.
const TREES = {
	counter: lines("● · Counter"),
	field: lines("● · Scoreboard", "├─● .home Counter", "└─● .away Counter"),
	depth: lines(
		"● · Page",
		"├─● .sidebar Sidebar",
		"│  └─● .search Search",
		"└─● .article Article",
		"   └─● .likes Counter",
	),
	views: lines("● · Dashboard", "├─● .count Counter:compact", "└─● .count Counter"),
	list: lines(
		"● · Counters",
		"└─● each .counters (3)",
		"   ├─● [0] Counter",
		"   ├─● [1] Counter",
		"   └─● [2] Counter",
	),
	// Items that aren't components are no step.
	each: lines("● · Checklist"),
	it: lines(
		"● · TodoList",
		"└─● each .todos (3)",
		"   ├─● [0]",
		"   │  └─● it Task",
		"   ├─● [1]",
		"   │  └─● it Task",
		"   └─● [2]",
		"      └─● it Task",
	),
	filter: lines(
		"● · OpenTodos",
		"├─● each .todos |open (2/3)",
		"│  ├─● [0] Task",
		"│  └─● [2] Task",
		"└─● each .todos (3)",
		"   ├─● [0] Task",
		"   ├─● [1] Task",
		"   └─● [2] Task",
	),
	keys: lines(
		"● · House",
		"└─● each .rooms (3)",
		'   ├─● ["kitchen"] Room',
		'   ├─● ["bedroom"] Room',
		'   └─● ["garage"] Room',
	),
	index: lines("● · Tabs", "└─● .tabs[.current=1] Tab"),
	route: lines("● · Router", '└─● .pages[.current="docs"] Tab'),
	provided: lines(
		"● · App",
		"├─● .theme Theme",
		"└─● .editor Editor",
		"   └─● .toolbar Toolbar",
		"      └─● *theme ^2.theme Theme",
	),
	if: lines("● · Disclosure"),
	nested: lines(
		"● · TaggedTodos",
		"└─● each .todos (3)",
		"   ├─● [0] Todo",
		"   │  └─● each .tags (2)",
		"   │     ├─● [0] Tag",
		"   │     └─● [1] Tag",
		"   ├─● [1] Todo",
		"   │  └─● each .tags (2)",
		"   │     ├─● [0] Tag",
		"   │     └─● [1] Tag",
		"   └─● [2] Todo",
		"      └─● each .tags (2)",
		"         ├─● [0] Tag",
		"         └─● [1] Tag",
	),
	notify: lines(
		"● · Shop",
		"└─● .cart Cart",
		"   └─● each .lines (3)",
		"      ├─● [0] Line",
		"      ├─● [1] Line",
		"      └─● [2] Line",
	),
	sendAt: lines(
		"● · Playlist",
		"├─● each .tracks (3)",
		"│  ├─● [0] Track",
		"│  ├─● [1] Track",
		"│  └─● [2] Track",
		"└─● .tracks[.current=0] Track:now",
	),
	jump: lines(
		"● · Board",
		"└─● each .cards (3)",
		"   ├─● [0] Card",
		"   │  └─● *theme ^1.theme Theme",
		"   ├─● [1] Card",
		"   │  └─● *theme ^1.theme Theme",
		"   └─● [2] Card",
		"      └─● *theme ^1.theme Theme",
	),
	workspace: lines(
		"● · Workspace",
		'├─● .pages[.current="docs"] Page',
		"│  ├─● *theme ^1.theme Theme",
		"│  ├─● .sidebar Sidebar",
		"│  │  └─● .search Search",
		"│  └─● .notes Counter",
		"├─● each .todos |open (2/3)",
		"│  ├─● [0] Todo",
		"│  │  └─● each .tags (2)",
		"│  │     ├─● [0] Tag",
		"│  │     └─● [1] Tag",
		"│  └─● [2] Todo",
		"│     └─● each .tags (2)",
		"│        ├─● [0] Tag",
		"│        └─● [1] Tag",
		"└─● each .todos (3)",
		"   ├─● [0]",
		"   │  └─● it Todo:row",
		"   ├─● [1]",
		"   │  └─● it Todo:row",
		"   └─● [2]",
		"      └─● it Todo:row",
	),
};

test("paths tour: every example has its tree written here", () => {
	assert.deepEqual(
		examples.map((e) => e.id),
		Object.keys(TREES),
	);
	assert.equal(exampleOf("nope"), examples[0]);
});

for (const { id } of examples) {
	test(`paths tour, ${id}: renders its tree, and the tour shows a row per step`, async () => {
		const app = mount(id);
		assert.equal(treeText(app), TREES[id]);
		const rows = app.window.document.querySelectorAll("#path-tree .pt-row");
		assert.equal(rows.length, TREES[id].split("\n").length);
		// Every click with a handler: the tour reads the path the host sends it to.
		const regions = scanRegions(app.rootNode);
		for (const button of app.rootNode.querySelectorAll("button")) {
			const event = new app.window.MouseEvent("click", { bubbles: true });
			Object.defineProperty(event, "target", { value: button });
			const capture = captureOf(event, app.host, regions);
			if (capture === null) continue;
			assert.equal(capture.chain[0].key, pathKey(capture.to.path), `${id}: ${button.textContent}`);
			assert.deepEqual(capture.chain, chainOf(regions, button));
		}
		await assertClean(app);
	});
}

test("paths tour: the examples take every kind of step", () => {
	const kinds = new Set();
	const walk = (node) => {
		kinds.add(node.step.t);
		for (const child of node.children ?? []) walk(child);
	};
	for (const id of Object.keys(TREES)) walk(pathTree(mount(id).state(), { siblings: 12 }));
	assert.deepEqual([...kinds].sort(), [
		"each",
		"field",
		"it",
		"item",
		"provided",
		"root",
		"seqItem",
	]);
});

test("paths tour: a branch taken adds its step", () => {
	const app = mount("if");
	app.fire("click", app.$("button"));
	assert.equal(treeText(app), lines("● · Disclosure", "└─● .details Counter"));
});

test("paths tour: a provided component's event changes the provider's state", () => {
	const app = mount("jump");
	const themes = app.rootNode.querySelectorAll("button:last-of-type");
	app.fire("click", themes[1]);
	assert.equal(app.state().theme.dark, true);
});

test("paths tour: a notify passes the cart and reaches the shop; a remove stops at the cart", () => {
	const app = mount("notify");
	const [, plus, remove] = app.rootNode.querySelectorAll("button");
	app.fire("click", plus);
	assert.equal(app.state().edits, 1);
	assert.equal(app.state().cart.lines[0].quantity, 3);
	app.fire("click", remove);
	assert.equal(app.state().cart.lines.length, 2);
	assert.equal(app.state().edits, 1);
});

test("paths tour: the playlist stops the track that was playing", () => {
	const app = mount("sendAt");
	const plays = [...app.rootNode.querySelectorAll("button")].filter(
		(b) => b.textContent === "play",
	);
	app.fire("click", plays[2]);
	const { current, tracks } = app.state();
	assert.equal(current, 2);
	assert.deepEqual(
		tracks.map((track) => track.playing),
		[false, false, true],
	);
	app.fire("click", [...app.rootNode.querySelectorAll("button")].at(-1));
	assert.equal(app.state().tracks[2].playing, false);
});

test("paths tour: a held click becomes steps, and the app changes at the one that delivers it", async () => {
	const app = mount("nested", { instant: false });
	const document = app.window.document;
	const tag = app.rootNode.querySelectorAll("button")[3]; // .todos[1].tags[1]
	app.fire("click", tag);
	const isOn = () => app.state().todos[1].tags[1].on;
	const pages = () => [...document.querySelectorAll(".tour-page")];
	const current = () => document.querySelector('.tour-page[aria-current="step"]').textContent;
	const tokens = () => [...document.querySelectorAll(".tour-token")].map((t) => t.textContent);
	// The event, five markers, the address, the message and what changed, between ⏮ ◀ and ▶ ⏭.
	assert.equal(pages().length, 9 + 4);
	assert.equal(current(), "1");
	assert.equal(isOn(), false, "held");
	assert.deepEqual(tokens(), []);

	pages().at(-2).click(); // ▶
	assert.equal(current(), "2");
	pages()[2 + 5].click(); // 6: the root's comment
	assert.deepEqual(tokens(), ["·", ".todos[1]", ".tags[1]"]);
	assert.equal(document.querySelectorAll("#path-tree .pt-light-walk").length, 3);
	assert.equal(isOn(), false);

	pages().at(-1).click(); // ⏭
	assert.equal(current(), "9");
	assert.equal(isOn(), true);
	const last = document.querySelector("#path-tree .pt-last");
	assert.match(last.textContent, /\[1\].*Tag/);
	assert.match(last.className, /pt-light-target/);
	// The root, the todo and the tag are new copies; the other todos and tags aren't.
	assert.equal(document.querySelectorAll("#path-tree .pt-copied").length, 3);
	const rows = rowsOf(app.state());
	assert.equal(rows.length, document.querySelectorAll("#path-tree .pt-row").length);

	pages()[0].click(); // ⏮: the app as it was before the event
	assert.equal(isOn(), false);
	assert.equal(document.querySelectorAll("#path-tree .pt-copied").length, 0);
	app.window.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "End" }));
	assert.equal(isOn(), true);
	await assertClean(app);
});

test("paths tour: the steps of a notify say where it passed and where it was handled", () => {
	const app = mount("notify", { instant: false });
	const document = app.window.document;
	app.fire("click", app.rootNode.querySelectorAll("button")[1]); // + on the first line
	assert.equal(app.state().edits, 0);
	const pages = [...document.querySelectorAll(".tour-page")];
	assert.deepEqual(
		pages.filter((b) => b.classList.contains("tour-page-applied")).map((b) => b.title),
		["send step", "notify changed", "notify changed", "What changed"],
	);
	pages.at(-1).click();
	assert.equal(app.state().edits, 1);
	const notes = [...document.querySelectorAll("#path-tree .pt-note")].map((n) => n.textContent);
	assert.deepEqual(notes, ["changed handled", "changed passed", "step handled"]);
});

// The trail: what the tour's own host (host.tour) shows of what went through each place.
// Math.random's shape, going through twelfths: the names it picks are the same every run.
const twelfths = () => {
	let i = 0;
	return () => (i++ % 12) / 12;
};
const trailOf = (example, { askHandlers = {}, ...options } = {}) => {
	const random = twelfths();
	const app = mount(example, {
		askHandlers: {
			models: () => [],
			agentName: ([taken]) => pickName(taken, random),
			...askHandlers,
		},
		...options,
	});
	const document = app.window.document;
	const tour = app.host.tour;
	const drain = () => {
		while (tour.tasks.length > 0) tour.handleTasks();
	};
	const click = (el) => {
		el.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
		drain();
	};
	const rows = () => [...document.querySelectorAll("#path-tree .pt-row")];
	// The counts of the row whose text matches, "" when it shows none.
	const counts = (match) =>
		rows()
			.find((row) => match.test(row.textContent))
			?.querySelector(".pt-counts")?.textContent ?? "";
	const all = (selector) => [...document.querySelectorAll(selector)];
	// Says text to the agent, and waits for what the tools it calls lead to.
	const say = async (text) => {
		const prompt = document.querySelector('textarea[aria-label="Prompt"]');
		prompt.value = text;
		prompt.dispatchEvent(new app.window.Event("input", { bubbles: true }));
		drain();
		const submit = new app.window.Event("submit", { bubbles: true, cancelable: true });
		document.querySelector("form.agent-prompt").dispatchEvent(submit);
		await tour.whenIdle();
		drain();
	};
	const results = () =>
		tour.root.agents[tour.root.current].transcript.messages
			.filter((m) => m.role === "toolResult")
			.map((m) => ({ text: m.content[0].text, isError: m.isError }));
	const input = (el, value) => {
		el.value = value;
		el.dispatchEvent(new app.window.Event("input", { bubbles: true }));
		drain();
	};
	const submit = (el) => {
		el.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
		drain();
	};
	const change = (el, value) => {
		el.value = value;
		el.dispatchEvent(new app.window.Event("change", { bubbles: true }));
		drain();
	};
	// Puts an agent at the row at index, as profile (the one selected when it's left out).
	const addAgent = (index, profile = null) => {
		click(rows()[index]);
		if (profile !== null) change(document.querySelector(".trail-profile"), profile);
		click(document.querySelector(".trail-add-agent"));
	};
	// The rows with marks of a kind (.pt-agent, .pt-base), as "mark row's text".
	const marks = (selector) =>
		all(selector).map((mark) => `${mark.textContent} ${mark.closest(".pt-row").textContent}`);
	const text = (selector) => document.querySelector(selector)?.textContent ?? "";
	return {
		...app,
		document,
		tour,
		drain,
		click,
		change,
		input,
		submit,
		rows,
		counts,
		all,
		say,
		results,
		addAgent,
		marks,
		text,
	};
};

test("paths tour: each place counts what went through it, once per event", () => {
	const app = trailOf("notify", { instant: false });
	const [, plus, remove] = app.rootNode.querySelectorAll("button");
	assert.equal(app.all(".pt-counts").length, 0);
	app.fire("click", plus);
	// event/walk/passed/handled: the line, the cart changed passes through, the shop.
	assert.equal(app.counts(/\[0\].*Line/), "1/0/0/1");
	assert.equal(app.counts(/Cart/), "0/1/1/0");
	assert.equal(app.counts(/Shop/), "0/1/0/1");
	assert.equal(app.counts(/\[1\].*Line/), "");
	// Going through its steps counts nothing more, forth or back.
	const pages = app.all(".tour-page");
	pages.at(-1).click();
	pages[0].click();
	assert.equal(app.counts(/Cart/), "0/1/1/0");
	pages.at(-1).click();
	app.fire("click", app.rootNode.querySelectorAll("button")[1]);
	assert.equal(app.counts(/\[0\].*Line/), "2/0/0/2");
	assert.equal(app.counts(/Cart/), "0/2/2/0");
	// removeLine is handled at the cart, which stops it: nothing more at the shop.
	app.fire("click", remove);
	assert.equal(app.counts(/Cart/), "0/3/2/1");
	assert.equal(app.counts(/Shop/), "0/3/0/2");
	assert.match(app.document.querySelector(".pt-counts").title, /3 events walked through/);
	app.click(app.document.querySelector(".trail-reset"));
	assert.equal(app.all(".pt-counts").length, 0);
});

test("paths tour: a message sent down counts where it's handled, with no event there", () => {
	const app = trailOf("sendAt");
	const plays = [...app.rootNode.querySelectorAll("button")].filter(
		(b) => b.textContent === "play",
	);
	app.fire("click", plays[2]);
	assert.equal(app.counts(/\[2\].*Track/), "1/0/0/1");
	assert.equal(app.counts(/Playlist/), "0/1/0/1");
	assert.equal(app.counts(/\[0\].*Track/), "0/0/0/1");
});

test("paths tour: a row's place opens in the inspector, a kind lists its entries, one opens in full", () => {
	const app = trailOf("notify");
	app.fire("click", app.rootNode.querySelectorAll("button")[1]);
	assert.match(app.document.querySelector(".trail-probe").textContent, /Click a row/);
	app.click(app.rows()[1]); // The cart.
	assert.equal(app.all(".pt-selected").length, 1);
	assert.equal(app.document.querySelector(".trail-label").textContent, ".cart");
	assert.deepEqual(
		app.all(".trail-chip").map((chip) => chip.textContent),
		[
			"0 events here",
			"1 events walked through",
			"1 notifications passed through",
			"0 handled here",
			"0 not delivered or failed",
		],
	);
	assert.equal(app.all(".trail-line").length, 0);
	app.click(app.all(".trail-chip")[2]);
	assert.deepEqual(
		app.all(".trail-line").map((line) => line.textContent),
		["#5 notify changed() from .cart .lines[0]: passed"],
	);
	app.click(app.document.querySelector(".trail-line"));
	const detail = JSON.parse(app.document.querySelector(".trail-detail").textContent);
	assert.deepEqual(
		{ ...detail, seq: null, cause: null, origin: null },
		{
			n: 5,
			click: 1,
			kind: "passed",
			mode: "notify",
			name: "changed",
			args: [],
			eventType: "click",
			outcome: "passed",
			seq: null,
			cause: null,
			origin: null,
			from: ".cart .lines[0]",
			to: ".cart",
			error: null,
			emitted: [],
			unhandled: [],
			watch: null,
		},
	);
	assert.equal(detail.origin, detail.cause);
	// The event's own entry keeps the message's args.
	app.click(app.rows()[3]);
	app.click(app.all(".trail-chip")[0]);
	assert.deepEqual(
		app.all(".trail-line").map((line) => line.textContent),
		["#1 click → step(1)"],
	);
});

test("paths tour: an agent has a base and a place it's at, which its tools move", async () => {
	const app = trailOf("notify");
	app.fire("click", app.rootNode.querySelectorAll("button")[1]);
	assert.match(app.text(".trail-add-agent"), /Click a row/);
	assert.equal(app.document.querySelector(".trail-add-agent").disabled, true);
	app.addAgent(3); // The first line.
	assert.equal(app.text(".trail-tab"), "🦥 Quiet Amber Sloth");
	assert.match(app.text(".trail-about"), /Explorer · based at \.cart \.lines\[0\]/);
	assert.equal(app.marks(".pt-agent").length, 1);
	assert.match(app.marks(".pt-agent")[0], /^🦥 .*\[0\].*Line/);
	assert.deepEqual(app.marks(".pt-base"), []);

	await app.say("/up {}");
	assert.match(app.marks(".pt-agent")[0], /Cart/);
	assert.match(app.marks(".pt-base")[0], /^⚓🦥 .*\[0\].*Line/);
	const up = app.results().at(-1).text;
	assert.match(
		up,
		/^You are Quiet Amber Sloth, a Explorer\.\nYour base is \.cart \.lines\[0\]\. You are now at \.cart \(Cart\)\./,
	);
	assert.match(up, /1\. \.cart \.lines\[0\] \(Line\): 1\/0\/0\/1\/0/);
	// The inspector stays where it was.
	assert.match(app.text(".pt-selected"), /\[0\].*Line/);

	await app.say('/entries {"kind": "passed"}');
	assert.equal(app.results().at(-1).text, "#5 notify changed() from .cart .lines[0]: passed");
	await app.say('/entries {"kind": "all", "limit": 1, "where": "base"}');
	assert.equal(
		app.results().at(-1).text,
		"#4 send step(1) from host: handled\n(1 older ones not shown)",
	);
	await app.say('/entry {"n": 5}');
	assert.equal(JSON.parse(app.results().at(-1).text).at, ".cart");
	await app.say('/trace {"n": 5}');
	assert.equal(
		app.results().at(-1).text,
		[
			"#1 at .cart .lines[0]: click → step(1)",
			"#2 at .cart: click at .cart .lines[0] → step(1), walking up",
			"#3 at ·: click at .cart .lines[0] → step(1), walking up",
			"#4 at .cart .lines[0]: send step(1) from host: handled",
			"#5 at .cart: notify changed() from .cart .lines[0]: passed",
			"#6 at ·: notify changed() from .cart .lines[0]: handled",
		].join("\n"),
	);
	await app.say('/busiest {"kind": "handled"}');
	assert.equal(app.results().at(-1).text, "1 at .cart .lines[0] (Line)\n1 at · (Shop)");

	// What it reads of a place: the current one, or its base.
	await app.say("/spec {}");
	assert.deepEqual(JSON.parse(app.results().at(-1).text), {
		at: ".cart",
		component: "Cart",
		fields: { lines: { type: "array", items: {} } },
		messages: [{ name: "removeLine", pure: false, args: "not declared" }],
		queries: [{ name: "total", args: [] }],
		notifies: [],
		views: ["main"],
	});
	await app.say('/spec {"where": "base"}');
	assert.equal(JSON.parse(app.results().at(-1).text).component, "Line");
	await app.say('/state {"where": "base"}');
	assert.deepEqual(JSON.parse(app.results().at(-1).text), {
		name: "Coffee beans",
		price: 12.5,
		quantity: 3,
	});

	// What happens next reaches it where it is.
	app.fire("click", app.rootNode.querySelectorAll("button")[1]);
	await app.say("/here {}");
	assert.match(app.results().at(-1).text, /Here: 0 events here, 2 events walked through, 2 notif/);

	await app.say('/down {"child": 2}');
	assert.match(app.marks(".pt-agent")[0], /\[1\].*Line/);
	await app.say('/down {"child": 1}');
	assert.equal(app.results().at(-1).isError, true);
	assert.match(app.results().at(-1).text, /There's no place 1 below: there are 0\./);
	await app.say('/go_to {"path": "·"}');
	assert.match(app.marks(".pt-agent")[0], /Shop/);
	await app.say("/up {}");
	assert.match(app.results().at(-1).text, /This is the root/);
	await app.say('/go_to {"path": ".lines"}');
	assert.equal(app.results().at(-1).isError, true);
	assert.match(app.results().at(-1).text, /Did you mean: \.cart \.lines\[0\], \.cart \.lines\[1\]/);
	await app.say("/home {}");
	assert.match(app.marks(".pt-agent")[0], /\[0\].*Line/);
	assert.deepEqual(app.marks(".pt-base"), []);
	assert.match(app.results().at(-1).text, /You are at your base, \.cart \.lines\[0\] \(Line\)\./);

	app.click(app.document.querySelector(".trail-close-agent"));
	assert.equal(app.all(".pt-agent").length, 0);
	assert.equal(app.all(".trail-tab").length, 0);
	assert.deepEqual(app.problems, []);
});

test("paths tour: several agents, each with its name, its mark and its place", async () => {
	const app = trailOf("notify");
	app.addAgent(3);
	app.addAgent(3);
	app.addAgent(1);
	assert.deepEqual(
		app.all(".trail-tab").map((tab) => tab.textContent),
		["🦥 Quiet Amber Sloth", "🐒 Wary Moss Monkey", "🦜 Drowsy Saffron Parrot"],
	);
	assert.deepEqual(
		app.all(".trail-tab").map((tab) => tab.getAttribute("aria-selected")),
		["false", "false", "true"],
	);
	// Two on the first line, one on the cart.
	assert.deepEqual(
		app.marks(".pt-agent").map((mark) => mark.replace(/ .*(Cart|Line).*/, " $1")),
		["🦜 Cart", "🦥 Line", "🐒 Line"],
	);
	assert.equal(app.all(".pt-agent")[1].title, "Quiet Amber Sloth is here");

	// Each one moves alone; the tab picks which one the panel is.
	app.click(app.all(".trail-tab")[1]);
	assert.equal(app.document.querySelector(".trail-name"), null, "no name to type until asked");
	app.click(app.document.querySelector(".trail-name-edit"));
	assert.equal(app.document.querySelector(".trail-name").value, "Wary Moss Monkey");
	app.click(app.document.querySelector(".trail-name-cancel"));
	assert.equal(app.document.querySelector(".trail-name"), null);
	await app.say('/go_to {"path": "·"}');
	assert.deepEqual(
		app.marks(".pt-agent").map((mark) => mark.replace(/ .*(Shop|Cart|Line).*/, " $1")),
		["🐒 Shop", "🦜 Cart", "🦥 Line"],
	);
	await app.say("/agents {}");
	assert.equal(
		app.results().at(-1).text,
		[
			"Quiet Amber Sloth, a Explorer: based at .cart .lines[0], now at .cart .lines[0]",
			"Drowsy Saffron Parrot, a Explorer: based at .cart, now at .cart",
		].join("\n"),
	);
	await app.say("/home {}");
	assert.match(app.results().at(-1).text, /Also here: Quiet Amber Sloth\./);

	// A new name: the tab, the mark and what it's told say it. Not an empty one, nor another's.
	// The pencil turns it into a name to type, which ✓ (or Enter) takes and ✕ leaves.
	const rename = (text, take = true) => {
		if (app.document.querySelector(".trail-name") === null) {
			app.click(app.document.querySelector(".trail-name-edit"));
		}
		app.input(app.document.querySelector(".trail-name"), text);
		if (take) app.submit(app.document.querySelector("form.trail-rename"));
		else app.click(app.document.querySelector(".trail-name-cancel"));
	};
	rename("Nobody", false);
	assert.equal(app.all(".trail-tab")[1].textContent, "🐒 Wary Moss Monkey");
	rename("  Tracer ");
	assert.equal(app.document.querySelector(".trail-name"), null);
	assert.equal(app.all(".trail-tab")[1].textContent, "🐒 Tracer");
	assert.equal(app.all(".pt-agent")[2].title, "Tracer is here");
	await app.say("/here {}");
	assert.match(app.results().at(-1).text, /^You are Tracer, a Explorer\./);
	rename("Quiet Amber Sloth");
	assert.equal(app.text(".trail-problem"), "Another agent is called Quiet Amber Sloth.");
	rename(" ");
	assert.equal(app.text(".trail-problem"), "A name can't be empty.");
	app.click(app.document.querySelector(".trail-name-cancel"));
	assert.equal(app.all(".trail-problem").length, 0);
	assert.equal(app.tour.root.agents[1].target.name, "Tracer");

	// Closing one leaves the others, with their sessions.
	app.click(app.document.querySelector(".trail-close-agent"));
	assert.deepEqual(
		app.all(".trail-tab").map((tab) => tab.textContent),
		["🦥 Quiet Amber Sloth", "🦜 Drowsy Saffron Parrot"],
	);
	assert.equal(app.all(".pt-agent").length, 2);
	assert.deepEqual(app.problems, []);
});

test("paths tour: an agent tells another, which reads it now, or once it's done when it's busy", async () => {
	// The next inference waits for release, when there's one to wait for.
	let gate = null;
	const app = trailOf("notify", {
		askHandlers: {
			infer: ([request]) => {
				if (gate === null) return echoStep(request);
				const { promise } = gate;
				gate = null;
				return promise.then(() => echoStep(request));
			},
		},
	});
	app.addAgent(3);
	app.addAgent(1);
	const sloth = () => app.tour.root.agents[0];
	const heard = () =>
		sloth()
			.transcript.messages.filter((m) => m.role === "user")
			.map((m) => m.content);

	// The monkey tells the sloth, which is idle: it reads it at once, as the user's message,
	// and the monkey's tool doesn't wait for what it does about it.
	await app.say(
		'/tell {"name": "Quiet Amber Sloth", "text": "I\'m about to step the first line."}',
	);
	assert.deepEqual(app.results().at(-1), {
		text: "Told Quiet Amber Sloth. It reads it once it's done with what it's doing; what it answers, if anything, comes to you as a message.",
		isError: false,
	});
	assert.deepEqual(heard(), ["Message from Wary Moss Monkey: I'm about to step the first line."]);
	assert.deepEqual(sloth().target.inbox, []);
	assert.equal(sloth().transcript.messages.at(-1).role, "assistant");
	assert.equal(sloth().isBusy, false);

	// Not one that isn't there, nor itself.
	await app.say('/tell {"name": "Nobody", "text": "hi"}');
	assert.deepEqual(app.results().at(-1), {
		text: "it can't run with these arguments now: There's no agent Nobody. There are: Quiet Amber Sloth.",
		isError: true,
	});
	await app.say('/tell {"name": "Wary Moss Monkey", "text": "hi"}');
	assert.deepEqual(app.results().at(-1), {
		text: "it can't run with these arguments now: That's you: tell another agent.",
		isError: true,
	});

	// The sloth is busy (its model hasn't answered): what it's told waits in its inbox, and the
	// monkey's tool is answered all the same.
	let release;
	gate = { promise: new Promise((resolve) => (release = resolve)) };
	app.click(app.all(".trail-tab")[0]);
	const asked = app.say("/here {}");
	assert.equal(sloth().isBusy, true);
	app.click(app.all(".trail-tab")[1]);
	const told = app.say('/tell {"name": "Quiet Amber Sloth", "text": "Done, it\'s yours."}');
	await new Promise((resolve) => setTimeout(resolve, 20));
	app.drain();
	assert.match(app.results().at(-1).text, /^Told Quiet Amber Sloth\./);
	assert.deepEqual(sloth().target.inbox, [{ from: "Wary Moss Monkey", text: "Done, it's yours." }]);
	assert.equal(heard().length, 2);
	assert.equal(sloth().isBusy, true);

	// Once it's done with what it was asked, it reads it.
	release();
	await asked;
	await told;
	assert.deepEqual(heard().slice(1), [
		"/here {}",
		"Message from Wary Moss Monkey: Done, it's yours.",
	]);
	assert.deepEqual(sloth().target.inbox, []);
	assert.equal(sloth().isBusy, false);
	const roles = sloth().transcript.messages.map((m) => m.role);
	assert.deepEqual(roles.slice(-4), ["toolResult", "assistant", "user", "assistant"]);
	assert.deepEqual(app.problems, []);
});

test("paths tour: an agent sends the component where it is, or at its base, a message, and the trail keeps what it did", async () => {
	const app = trailOf("notify", { instant: false });
	app.addAgent(3);
	await app.say("/up {}");
	// A click being gone through is over once an agent changes the app.
	app.fire("click", app.rootNode.querySelectorAll("button")[1]);
	assert.equal(app.state().cart.lines[0].quantity, 2, "held");
	await app.say('/send {"name": "step", "args": [2], "where": "base"}');
	assert.equal(app.state().cart.lines[0].quantity, 5);
	assert.equal(app.state().edits, 2);
	assert.equal(app.all(".tour-page").length, 0);
	assert.deepEqual(app.results().at(-1), {
		isError: false,
		text: [
			"Sent. What it did, in order:",
			"  at .cart .lines[0]: send step(2) from agent Quiet Amber Sloth: handled",
			"  at .cart: notify changed() from .cart .lines[0]: passed",
			"  at ·: notify changed() from .cart .lines[0]: handled",
			'State there now: {"name":"Coffee beans","price":12.5,"quantity":5}',
		].join("\n"),
	});
	// The click's and the agent's: one event, two handled at the line.
	assert.equal(app.counts(/\[0\].*Line/), "1/0/0/2");
	assert.equal(app.counts(/Cart/), "0/1/2/0");
	assert.equal(app.counts(/Shop/), "0/1/0/2");
	await app.say('/entries {"kind": "handled", "limit": 1, "where": "base"}');
	assert.match(
		app.results().at(-1).text,
		/^#7 send step\(2\) from agent Quiet Amber Sloth: handled/,
	);

	// A message it doesn't have isn't sent, and says which it has.
	await app.say('/send {"name": "explode", "args": [], "where": "base"}');
	assert.equal(app.results().at(-1).isError, true);
	assert.match(
		app.results().at(-1).text,
		/Line at \.cart \.lines\[0\] has no message explode; it has: step, remove\./,
	);
	// Without where it's for the place it's at: the cart, which has no step.
	await app.say('/send {"name": "step", "args": [1]}');
	assert.match(
		app.results().at(-1).text,
		/Cart at \.cart has no message step; it has: removeLine\./,
	);
	await app.say('/down {"child": 2}');
	await app.say('/send {"name": "step", "args": [4]}');
	assert.equal(app.state().cart.lines[1].quantity, 5);
	assert.equal(app.state().cart.lines[0].quantity, 5);
	assert.match(app.results().at(-1).text, /at \.cart \.lines\[1\]: send step\(4\) from agent/);
	assert.equal(app.state().edits, 3);
	// remove: the cart handles the line's removeLine, and the base is gone.
	await app.say('/send {"name": "remove", "args": [], "where": "base"}');
	assert.equal(app.state().cart.lines.length, 2);
	assert.match(app.results().at(-1).text, /at \.cart: notify removeLine\(\) from .*: handled/);
	await new Promise((resolve) => setTimeout(resolve, 20));
	app.drain();
	assert.deepEqual(app.problems, []);
});

test("paths tour: an agent runs the queries of the component where it is, or at its base, which change nothing", async () => {
	const app = trailOf("notify");
	app.addAgent(3);
	await app.say("/up {}");
	const before = app.state();
	await app.say('/query {"name": "total", "args": [], "where": "current"}');
	assert.deepEqual(app.results().at(-1), { isError: false, text: '"37.75"' });
	// What it reads is the app now: after a change, the total is another.
	await app.say('/send {"name": "step", "args": [2], "where": "base"}');
	await app.say('/query {"name": "total", "args": []}');
	assert.equal(app.results().at(-1).text, '"62.75"');
	assert.equal(app.state().edits, before.edits + 1, "only the send changed the app");
	// A query it doesn't have doesn't run, and says which it has.
	await app.say('/query {"name": "total", "args": [], "where": "base"}');
	assert.equal(app.results().at(-1).isError, true);
	assert.match(
		app.results().at(-1).text,
		/Line at \.cart \.lines\[0\] has no query total; it has: none\./,
	);
	await app.say('/query {"name": "count", "args": []}');
	assert.match(app.results().at(-1).text, /Cart at \.cart has no query count; it has: total\./);
	await new Promise((resolve) => setTimeout(resolve, 20));
	app.drain();
	assert.deepEqual(app.problems, []);
});

test("paths tour: an agent is placed with a profile, whose prompt the model is given", async () => {
	const requests = [];
	const app = trailOf("notify", {
		askHandlers: {
			infer: ([request]) => {
				requests.push(request);
				return echoStep(request);
			},
		},
	});
	assert.deepEqual(
		app.all(".trail-profile option").map((option) => option.value),
		PROFILES.map((profile) => profile.id),
	);
	app.addAgent(3, "bug-fixer");
	assert.match(app.text(".trail-about"), /^Bug fixer · based at/);
	await app.say("/here {}");
	const { systemPrompt, tools } = requests[0];
	assert.ok(systemPrompt.includes(PROFILES[1].prompt));
	assert.match(
		systemPrompt,
		/You have a base[\s\S]*You are a bug fixer[\s\S]*Now: You are Quiet Amber Sloth, a Bug fixer\./,
	);
	assert.deepEqual(
		tools.map((tool) => tool.name),
		[
			"here",
			"spec",
			"state",
			"entries",
			"entry",
			"trace",
			"busiest",
			"agents",
			"tell",
			"up",
			"down",
			"go_to",
			"home",
			"query",
			"send",
		],
	);
	assert.deepEqual(tools.find((tool) => tool.name === "send").parameters.required, [
		"name",
		"args",
		"where",
	]);
	// The next one is what the select says.
	app.addAgent(1, "designer");
	assert.match(app.text(".trail-about"), /^Designer · based at \.cart$/);
});

test("paths tour: an agent stops at 50 steps, and Continue beside the error asks it to go on", async () => {
	// A model that never stops: whatever it's told, it calls here.
	let asked = 0;
	const app = trailOf("notify", {
		askHandlers: {
			infer: ([{ tools, transcript }]) => {
				asked += 1;
				return echoStep({
					tools,
					transcript: [...transcript.slice(0, -1), { role: "user", content: "/here {}" }],
				});
			},
		},
	});
	app.addAgent(3);
	assert.equal(app.document.querySelector(".agent-continue"), null);
	await app.say("go");
	assert.equal(asked, 50);
	assert.equal(app.text(".agent-error p"), "Stopped after 50 steps.");
	assert.equal(app.text(".agent-continue"), "Continue");
	const users = () =>
		app.tour.root.agents[0].transcript.messages
			.filter((m) => m.role === "user")
			.map((m) => m.content);
	app.click(app.document.querySelector(".agent-continue"));
	await app.tour.whenIdle();
	app.drain();
	assert.deepEqual(users(), ["go", "continue"]);
	assert.equal(asked, 100);
	assert.equal(app.text(".agent-error p"), "Stopped after 50 steps.");
	// Cleared, neither the error nor the button is there.
	app.click(app.all(".agent-prompt button").find((b) => b.textContent === "Clear"));
	assert.equal(app.document.querySelector(".agent-error"), null);
	assert.deepEqual(app.problems, []);
});

test("paths tour: new agents use the inference server's models when it has any", async () => {
	const none = trailOf("notify");
	assert.match(none.text(".trail-status"), /^No inference server: agents use the echo model/);
	none.addAgent(1);
	assert.equal(none.tour.root.agents[0].model, "echo/echo");

	const models = [
		{ provider: "test", id: "one", name: "One" },
		{ provider: "test", id: "two", name: "Two" },
	];
	const app = trailOf("notify", { askHandlers: { models: () => models } });
	await app.tour.whenIdle();
	app.drain();
	assert.equal(app.text(".trail-status"), "2 models from the inference server.");
	app.addAgent(1);
	assert.equal(app.tour.root.agents[0].model, "test/one");
	assert.deepEqual(
		app.all('select[aria-label="Model"] option').map((option) => option.value),
		["echo/echo", "test/one", "test/two"],
	);
	// The model picked in one is the one the next starts with.
	app.change(app.document.querySelector('select[aria-label="Model"]'), "test/two");
	await new Promise((resolve) => setTimeout(resolve, 20));
	await app.tour.whenIdle();
	app.drain();
	app.addAgent(3);
	assert.equal(app.tour.root.agents[1].model, "test/two");
	assert.equal(app.tour.root.agents[0].model, "test/two");
});

test("paths tour: agent names are a manner, a material and a dweller, each agent's its own", () => {
	const all = new Set();
	for (const m of MANNERS.keys()) {
		for (const k of MATERIALS.keys()) {
			for (const d of DWELLERS.keys()) all.add(nameFrom([m, k, d]).name);
		}
	}
	assert.equal(all.size, 12 * 12 * 12);
	assert.deepEqual(nameFrom([2, 4, 2]), { name: "Patient Moss Sloth", icon: "🦥" });
	// A dweller none has while one is free, then a name none has.
	const taken = [];
	for (let i = 0; i < 12; i++) taken.push(pickName(taken, Math.random));
	assert.equal(new Set(taken.map((agent) => agent.icon)).size, 12);
	const zero = () => 0;
	const first = pickName([], zero);
	assert.deepEqual(first, { name: "Quiet Copper Squirrel", icon: "🐿️" });
	assert.equal(pickName([first], zero).name, "Quiet Copper Owl");
	const everyFirst = DWELLERS.map((_, d) => nameFrom([0, 0, d]));
	assert.equal(pickName(everyFirst, zero).name, "Quiet Amber Squirrel");
});

test("paths tour: the probe's agent meta names messages and queries it has", () => {
	assert.deepEqual(agentProblems(trailComponents.Probe), []);
});

// The traces: the trail's log by what caused what (spans.js), in the panel under the tour.
const spanLines = (trace) =>
	trace.spans.map(
		(s) =>
			`${"  ".repeat(s.depth)}${s.name} @ ${s.place} ${s.start}-${s.selfEnd}-${s.end} ${s.note}`,
	);
const tracesNow = (app) => tracesOf(app.host.tour.root.log, app.host.tour.root.nodes);

test("paths tour: an event is a trace, its tasks spans under the ones that sent them", () => {
	const app = trailOf("notify");
	app.fire("click", app.rootNode.querySelectorAll("button")[1]); // + on the first line
	const [trace, ...others] = tracesNow(app);
	assert.deepEqual(others, []);
	assert.equal(trace.id, 1);
	assert.equal(trace.status, "ok");
	// Three places read on the way up, then a tick per task; each hop of the notification is
	// under the one before it, and a span ends when all it caused did.
	assert.deepEqual(spanLines(trace), [
		"click → step(1) @ .cart .lines[0] 0-6-6 ",
		"  read path @ .cart .lines[0] 0-3-3 3 places",
		"  send step @ .cart .lines[0] 3-4-6 handled",
		"    notify changed @ .cart 4-5-6 passed",
		"      notify changed @ · 5-6-6 handled",
	]);
	const step = trace.spans[2];
	assert.deepEqual(
		step.events.map((event) => event.name),
		["emitted notify changed"],
	);
	const detail = spanDetail(trace.spans[3], trace.id);
	assert.equal(detail.trace_id, 1);
	assert.equal(detail.parent_span_id, step.id);
	assert.deepEqual(detail.status, { code: "OK", message: "passed" });
	assert.deepEqual(detail.scope, { name: "Cart" });
});

test("paths tour: a message sent down is a span under its sender's, at the place it went", () => {
	const app = trailOf("sendAt");
	const plays = [...app.rootNode.querySelectorAll("button")].filter(
		(b) => b.textContent === "play",
	);
	app.fire("click", plays[2]);
	const [trace] = tracesNow(app);
	const stop = trace.spans.find((s) => s.name === "send stop");
	const sender = trace.spans.find((s) => s.id === stop.parent);
	assert.equal(sender.comp, "Playlist");
	assert.match(stop.place, /\[0\]/);
	assert.equal(stop.depth, sender.depth + 1);
	assert.equal(sender.end, stop.end);
});

test("paths tour: the traces panel lists the traces, shows one's spans and follows the pager", async () => {
	const app = trailOf("notify", { instant: false });
	const document = app.window.document;
	const panel = document.querySelector("details.tour-traces");
	const title = () => panel.querySelector("summary").textContent;
	const spans = () => app.all("#path-traces .tr-span");
	const drain = () => {
		const { traces } = app.host;
		while (traces.tasks.length > 0) traces.handleTasks();
	};
	assert.equal(panel.open, false);
	assert.equal(title(), "Traces");
	assert.equal(spans().length, 0);

	const [, plus, remove] = app.rootNode.querySelectorAll("button");
	app.fire("click", plus);
	assert.equal(title(), "Traces · 1");
	assert.equal(spans().length, 5);
	assert.match(spans()[0].className, /tr-now/, "the first step is the event");
	const pages = app.all(".tour-page");
	pages.at(-2).click(); // ▶: the first marker
	assert.match(spans()[1].className, /tr-now/);
	pages.at(-1).click(); // ⏭
	assert.equal(app.all("#path-traces .tr-now").length, 1);

	// A span points at its place's row, and a click shows it in full and in the inspector.
	const cart = spans()[3];
	cart.dispatchEvent(new app.window.MouseEvent("mouseover", { bubbles: true }));
	assert.match(document.querySelector("#path-tree .pt-hover").textContent, /Cart/);
	app.click(cart);
	drain();
	const detail = JSON.parse(document.querySelector("#path-traces .tr-detail").textContent);
	assert.equal(detail.name, "notify changed");
	assert.match(document.querySelector("#path-tree .pt-selected").textContent, /Cart/);

	// A second event is the trace shown; the first is still in the list.
	app.fire("click", remove);
	assert.equal(title(), "Traces · 2");
	const list = () => app.all("#path-traces .tr-trace");
	assert.deepEqual(
		list().map((b) => b.getAttribute("aria-pressed")),
		["true", "false"],
	);
	assert.match(list()[0].textContent, /^#2 click → remove/);
	app.click(list()[1]);
	drain();
	assert.equal(spans().length, 5);

	// Opening it is remembered where the page has storage; this one has none.
	panel.open = true;
	panel.dispatchEvent(new app.window.Event("toggle"));

	app.click(document.querySelector(".trail-reset"));
	await settle();
	assert.equal(title(), "Traces");
	assert.equal(spans().length, 0);
});
