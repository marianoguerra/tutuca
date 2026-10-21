import assert from "node:assert/strict";
import test from "node:test";
import { mountTimeTravel, TimeTravel } from "../../src/history/bar.js";
import { historyEngine, Timeline } from "../../src/history/index.js";
import { button, component, field, send, t } from "../../src/tutuca.js";
import { dom, scopeWith, setupHost, testGenericProperties, testLintsClean } from "../helpers.js";

// A clock that moves by the gaps given, one per call.
const clock = (...gaps) => {
	let time = 0;
	return () => {
		time += gaps.shift() ?? 1000;
		return time;
	};
};
const states = (timeline) => timeline.entries.map((e) => e.state);

test("record after going back drops the states after the cursor", () => {
	const timeline = new Timeline();
	timeline.begin({ state: 0 });
	for (const state of [1, 2, 3]) timeline.record({ state });
	timeline.goto(1);
	timeline.record({ state: 9 });
	assert.deepEqual(states(timeline), [0, 1, 9]);
	assert.equal(timeline.cursor, 2);
	assert.equal(timeline.goto(-5).state, 0);
	assert.equal(timeline.goto(99).state, 9);
});

test("past max a burst thins out, keeping the first and the current state", () => {
	// 0 at 1000, 1 at 2000, then a burst 2, 3, 4 10ms apart, then 5 at 3030.
	const timeline = new Timeline({ max: 4, now: clock(1000, 1000, 10, 10, 10, 1000) });
	timeline.begin({ state: 0 });
	for (const state of [1, 2, 3, 4, 5]) timeline.record({ state });
	// The burst 2, 3, 4 loses 3; then 1, closest to 2, goes.
	assert.deepEqual(states(timeline), [0, 2, 4, 5]);
	assert.equal(timeline.current.state, 5);
	const tight = new Timeline({ max: 2, now: clock(1, 1, 1) });
	tight.begin({ state: "first" });
	tight.record({ state: "a" });
	tight.record({ state: "b" });
	assert.deepEqual(states(tight), ["first", "b"]);
});

test("merge folds a task into the entry its chain started, only at the end", () => {
	const root = { parent: null };
	const reply = { parent: { parent: root } };
	const timeline = new Timeline();
	timeline.begin({ state: 0 });
	assert.equal(timeline.merge(root, 1), false);
	timeline.record({ state: 1, rootTask: root, tasks: [root] });
	assert.equal(timeline.merge(reply, 2), true);
	assert.deepEqual(states(timeline), [0, 2]);
	assert.equal(timeline.current.tasks.length, 2);
	timeline.back();
	assert.equal(timeline.merge(reply, 3), false);
});

const Counter = component({
	name: "Counter",
	fields: { count: t.number() },
	view: button({ "on:click": send("inc") }, field("count")),
	on: {
		inc: {
			args: [],
			run(draft) {
				draft.count = this.count + 1;
			},
		},
	},
});

const counterHost = () => {
	const setup = setupHost({ Counter }, { sync: true });
	const changes = [];
	const engine = historyEngine({ onChange: (timeline) => changes.push(timeline.cursor) });
	const peer = {
		seen: [],
		commit(change) {
			this.seen.push(change.next.count);
		},
	};
	setup.host.attachSync(engine, peer);
	setup.host.start(setup.C.Counter());
	const click = () => setup.click(setup.rootNode.querySelector("button"));
	return { ...setup, engine, peer, changes, click };
};

test("the engine records labelled entries and travels by applying a past state", () => {
	const { host, rootNode, engine, peer, click } = counterHost();
	click();
	click();
	const { timeline } = engine;
	assert.deepEqual(
		timeline.entries.map((e) => [e.origin, e.label, e.state.count]),
		[
			["initial", "initial", 0],
			["user", "click → inc()", 1],
			["user", "click → inc()", 2],
		],
	);
	engine.travel(0);
	assert.equal(host.rootComponent.count, 0);
	assert.equal(rootNode.querySelector("button").textContent, "0");
	assert.equal(timeline.cursor, 0);
	assert.equal(timeline.size, 3, "travelling records nothing");
	assert.deepEqual(peer.seen, [1, 2, 0], "the other engines see the travel");
	engine.forward();
	assert.equal(host.rootComponent.count, 1);
	click();
	assert.deepEqual(
		states(timeline).map((s) => s.count),
		[0, 1, 2],
	);
	assert.equal(timeline.cursor, 2, "a change after travelling branches from there");
});

test("changes from another engine are recorded", () => {
	const { host, engine } = counterHost();
	let link = null;
	host.attachSync({ attach: (l) => (link = l), commit() {} });
	link.apply((draft) => {
		draft.count = 5;
	});
	assert.deepEqual(
		engine.timeline.entries.map((e) => [e.origin, e.state.count]),
		[
			["initial", 0],
			["external", 5],
		],
	);
});

testLintsClean("History", { TimeTravel });

testGenericProperties({ TimeTravel });

test("mountTimeTravel shows a bar once there are two states and travels from it", () => {
	const window = dom('<main id="app"></main><div id="bar"></div>');
	const { document } = window;
	const setup = setupHost({ Counter }, { sync: true });
	const { host } = setup;
	const { bar } = mountTimeTravel({ document, rootNode: document.getElementById("bar"), host });
	bar.scheduleNextTaskTick = () => {};
	const drainBar = () => {
		while (bar.tasks.length > 0) bar.handleTasks();
	};
	host.start(setup.C.Counter());
	drainBar();
	const barNode = document.getElementById("bar");
	assert.equal(barNode.querySelector('[aria-label="Time travel"]'), null);
	setup.click(setup.rootNode.querySelector("button"));
	setup.click(setup.rootNode.querySelector("button"));
	drainBar();
	assert.match(barNode.textContent, /state 3 of 3 · ☝ click → inc\(\)/);
	const back = barNode.querySelector('button[title="Back"]');
	back.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	drainBar();
	assert.equal(host.rootComponent.count, 1);
	assert.match(barNode.textContent, /state 2 of 3/);
	const slider = barNode.querySelector('[aria-label="State"]');
	slider.value = "0";
	slider.dispatchEvent(new window.Event("input", { bubbles: true }));
	drainBar();
	assert.equal(host.rootComponent.count, 0);
	assert.equal(scopeWith({ TimeTravel }).components.TimeTravel().isShown, false);
});
