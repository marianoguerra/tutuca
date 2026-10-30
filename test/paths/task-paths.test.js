import assert from "node:assert/strict";
import test from "node:test";
import { component, h, provided, render, send, seqItem, t } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

// itemHandlers holds Item's messages, and its replies under replies.
function setup(rootHandlers, { answers = {}, ...itemHandlers } = {}, useProvided = false) {
	const Item = component({
		name: "Item",
		fields: {
			count: t.number(),
			selected: t.number(),
			children: t.array(),
			reply: t.any(),
		},
		view: h("button", { id: "item", "on:click": send("inc") }, "inc"),
		on: {
			inc(next) {
				next.count++;
			},
			...itemHandlers,
		},
		answers,
	});
	const Root = component({
		name: "Root",
		fields: { selected: t.number(), committed: t.number(), items: t.array() },
		provides: {
			selectedItem(pb) {
				pb.seqItem("items", "selected");
			},
		},
		view: h(
			"div",
			{},
			...Object.keys(rootHandlers).map((name) =>
				h("button", { id: name, "on:click": send(name) }, name),
			),
			render(useProvided ? provided("selectedItem") : seqItem("items", "selected")),
		),
		on: rootHandlers,
	});
	const notices = [];
	const onReport = (type, info) => notices.push({ type, ...info });
	const { host, rootNode, C, drain } = setupHost({ Root, Item }, { sync: true, onReport });
	host.start(C.Root({ items: [C.Item(), C.Item()] }));
	function queueEvents(...ids) {
		const handleTasks = host.handleTasks;
		host.handleTasks = () => {};
		try {
			for (const id of ids) {
				host.handleEvent({
					type: "click",
					target: rootNode.querySelector(`#${id}`),
				});
			}
		} finally {
			host.handleTasks = handleTasks;
		}
	}
	return { host, notices, queueEvents, drain, rootNode, C };
}

test("generated paths capture producer commit before intervening tasks run", () => {
	const { host, notices, queueEvents, drain } = setup({
		queue(next, _args, ctx) {
			ctx.sendAt("inc", [], (pb) => pb.seqItem("items", "selected"));
			next.selected = 1;
		},
		change(next) {
			next.selected = 0;
		},
	});
	queueEvents("queue", "change");
	drain();
	assert.deepEqual(
		host.rootComponent.items.map((item) => item.count),
		[0, 1],
	);
	assert.equal(host.rootComponent.selected, 0);
	assert.equal(notices.filter(({ type }) => type.endsWith("Failed")).length, 0);
});

test("DOM event paths retain event-time selection behind older queued work", () => {
	const { host, queueEvents, drain } = setup({
		change(next) {
			next.selected = 1;
		},
	});
	queueEvents("change", "item");
	drain();
	assert.deepEqual(
		host.rootComponent.items.map((item) => item.count),
		[1, 0],
	);
});

test("failed producers discard drafts and children but preserve older tasks", () => {
	const error = new Error("producer failed");
	const { host, notices, queueEvents, drain, rootNode } = setup({
		fail(next, _args, ctx) {
			next.selected = 1;
			ctx.sendAt("inc", [], (pb) => pb.seqItem("items", "selected"));
			throw error;
		},
		keep(next) {
			next.committed++;
		},
	});
	queueEvents("fail", "keep");
	drain();
	assert.equal(host.rootComponent.selected, 0);
	assert.equal(host.rootComponent.committed, 1);
	assert.deepEqual(
		host.rootComponent.items.map((item) => item.count),
		[0, 0],
	);
	assert.equal(notices.find(({ type }) => type === "taskFailed").error, error);
	assert.equal(notices.at(-1).type, "render");
	assert.ok(rootNode.querySelector("#item"));
	assert.equal(host._handlingTasks, false);
});

test("child path preparation failure rolls back the producer and all its children", () => {
	let failedContext;
	const { host, notices, queueEvents, drain } = setup({
		fail(next, _args, ctx) {
			failedContext = ctx;
			next.selected = 1;
			ctx.sendAt("inc", [], (pb) => pb.seqItem("items", "selected"));
			ctx.sendAt("inc", [], (pb) => pb.field("missing").seqItem("items", "selected"));
		},
		keep(next) {
			next.committed++;
		},
	});
	queueEvents("fail", "keep");
	drain();
	assert.equal(host.rootComponent.selected, 0);
	assert.equal(host.rootComponent.committed, 1);
	assert.deepEqual(
		host.rootComponent.items.map((item) => item.count),
		[0, 0],
	);
	assert.deepEqual(
		notices.filter(({ task }) => task?.name === "fail").map(({ type }) => type),
		["taskFailed"],
	);
	// A retained context must not revive children of an aborted transaction.
	failedContext.sendAt("inc", [], (pb) => pb.item("items", 0));
	assert.equal(host.tasks.length, 0);
});

// An ask starts after the transaction that asked commits, and its answer comes back as a
// reply task of its own, now or later: a throwing ok reply fails only that reply, the same
// whether the answer came now or later, and doesn't run the error one.
test("a throwing sync ok reply fails its own reply task, not the ask, and doesn't run error", () => {
	const error = new Error("reply failed");
	const { host, notices, queueEvents, drain } = setup(
		{
			queue(_next, _args, ctx) {
				ctx.sendAt("request", [], (pb) => pb.seqItem("items", "selected"));
			},
		},
		{
			request(_next, _args, ctx) {
				ctx.ask("load");
			},
			answers: {
				load: {
					ok(next, _args, ctx) {
						next.reply = "ok";
						ctx.sendAt("inc", [], (_pb) => {});
						throw error;
					},
					error(next) {
						next.reply = "error";
					},
				},
			},
		},
	);
	host.scope.registerAskHandlers({ load: () => "result" });
	queueEvents("queue");
	drain();
	assert.equal(host.rootComponent.items[0].reply, null);
	assert.equal(host.rootComponent.items[0].count, 0);
	const failed = notices.find(({ type }) => type === "taskFailed");
	assert.equal(failed.error, error);
	assert.equal(failed.task.name, "load.ok");
});

for (const rejected of [false, true]) {
	test(`async ${rejected ? "error" : "success"} reply reuses captured caller path`, async () => {
		let settle;
		const pending = new Promise((resolve, reject) => {
			settle = rejected ? reject : resolve;
		});
		const replyHandler = (next, [value], ctx) => {
			next.reply = value;
			ctx.sendAt("inc", [], (_pb) => {});
		};
		const { host, notices, queueEvents, drain } = setup(
			{
				queue(next, _args, ctx) {
					ctx.sendAt("request", [], (pb) => pb.seqItem("items", "selected"));
					next.selected = 1;
				},
				change(next) {
					next.selected = 0;
				},
			},
			{
				request(_next, _args, ctx) {
					ctx.ask("load");
				},
				answers: { load: { ok: replyHandler, error: replyHandler } },
			},
		);
		host.scope.registerAskHandlers({ load: () => pending });
		queueEvents("queue");
		drain();
		const ask = notices.find(({ task }) => task?.name === "load").task;
		queueEvents("change");
		drain();
		settle("result");
		await pending.catch(() => {});
		await Promise.resolve();
		assert.equal(host.tasks.length, 1);
		assert.equal(host.tasks[0].to, ask.from);
		drain();
		assert.equal(host.rootComponent.items[1].reply, "result");
		assert.equal(host.rootComponent.items[0].reply, null);
		assert.deepEqual(
			host.rootComponent.items.map((item) => item.count),
			[0, 1],
		);
		assert.equal(notices.filter(({ type }) => type.endsWith("Failed")).length, 0);
	});
}

test("reentrant draining cannot execute children before their producer commits", () => {
	const { host, queueEvents, drain } = setup({
		queue(next, _args, ctx) {
			ctx.sendAt("inc", [], (pb) => pb.seqItem("items", "selected"));
			host.handleTasks();
			next.selected = 1;
		},
	});
	queueEvents("queue");
	drain();
	assert.deepEqual(
		host.rootComponent.items.map((item) => item.count),
		[0, 1],
	);
});

for (const renderThrows of [false, true]) {
	test(`events during rendering wait for the next tick${renderThrows ? " even when rendering throws" : ""}`, () => {
		const { host, queueEvents, rootNode } = setup({
			change(next) {
				next.committed++;
			},
		});
		queueEvents("change");
		const render = host.render;
		const error = new Error("render failed");
		let scheduled = 0;
		host.scheduleNextTaskTick = () => scheduled++;
		host.render = function () {
			render.call(this);
			rootNode.querySelector("#item").click();
			assert.equal(this.rootComponent.items[0].count, 0);
			assert.equal(this.tasks.length, 1);
			assert.equal(scheduled, 0);
			if (renderThrows) throw error;
		};
		// A render that throws is reported as renderFailed, not thrown out of the tick.
		const reported = [];
		const notify = host.notify;
		host.notify = (type, info) =>
			type === "renderFailed" ? reported.push(info.error) : notify.call(host, type, info);
		host.handleTasks();
		host.notify = notify;
		assert.deepEqual(reported, renderThrows ? [error] : []);
		assert.equal(host._handlingTasks, false);
		assert.equal(scheduled, 1);
		host.render = render;
		host.handleTasks();
		assert.equal(host.rootComponent.items[0].count, 1);
		assert.equal(host.tasks.length, 0);
	});
}

test("dynamic selectors below provided frames capture commit and retain bubbling", () => {
	const seen = [];
	const { host, notices, queueEvents, drain, C } = setup(
		{
			change(next) {
				next.items[0].selected = 0;
			},
			changed() {
				seen.push("root");
			},
		},
		{
			inc(next, _args, ctx) {
				ctx.sendAt("bump", [], (pb) => pb.seqItem("children", "selected"));
				next.selected = 1;
			},
			bump(next, _args, ctx) {
				next.count++;
				ctx.notify("changed");
			},
			changed() {
				seen.push("item");
			},
		},
		true,
	);
	host.rootComponent = C.Root({
		items: [C.Item({ selected: 0, children: [C.Item(), C.Item()] }), C.Item()],
	});
	host.render();
	queueEvents("item", "change");
	drain();
	assert.deepEqual(
		host.rootComponent.items[0].children.map((child) => child.count),
		[0, 1],
	);
	assert.deepEqual(seen, ["item", "root"]);
	assert.equal(notices.filter(({ type }) => type.endsWith("Failed")).length, 0);
});

// The tree spec's races (spec/tree, M4 and M5): a route records the identity of the
// component it reaches, and a message whose path another component took meanwhile is dropped
// as stale instead of reaching that one.
test("a reply to an asker that a list shift replaced at its index is dropped as stale", async () => {
	let settle;
	const pending = new Promise((resolve) => {
		settle = resolve;
	});
	const { host, notices, queueEvents, drain, C } = setup(
		{
			ask(_next, _args, ctx) {
				ctx.sendAt("request", [], (pb) => pb.item("items", 0));
			},
			shift(next) {
				next.items.unshift(C.Item({ count: 100 }));
			},
		},
		{
			request(_next, _args, ctx) {
				ctx.ask("load");
			},
			answers: {
				load: {
					ok(next, [r]) {
						next.reply = r;
					},
				},
			},
		},
	);
	host.scope.registerAskHandlers({ load: () => pending });
	queueEvents("ask");
	drain();
	queueEvents("shift");
	drain();
	settle("result");
	await pending;
	await Promise.resolve();
	drain();
	const [newcomer, asker] = host.rootComponent.items;
	assert.equal(newcomer.reply, null, "the item now at index 0 doesn't get it");
	assert.equal(asker.reply, null, "by path, the moved asker isn't found either");
	assert.deepEqual(
		notices.filter(({ type }) => type === "stale").map(({ task }) => task.name),
		["load.ok"],
	);
});

test("a send queued to a component that is replaced before it runs is dropped as stale", () => {
	const { host, notices, queueEvents, drain, C } = setup({
		poke(_next, _args, ctx) {
			ctx.sendAt("inc", [], (pb) => pb.item("items", 0));
		},
		renew(next) {
			next.items[0] = C.Item({ count: 50 });
		},
	});
	queueEvents("poke", "renew");
	drain();
	// renew's event ran after poke's, before the inc poke queued: the new item keeps its count.
	assert.equal(host.rootComponent.items[0].count, 50);
	assert.deepEqual(
		notices.filter(({ type }) => type === "stale").map(({ task }) => task.name),
		["inc"],
	);
});

test("updating a component keeps its identity: a send queued before still reaches it", () => {
	const { host, notices, queueEvents, drain } = setup({
		poke(_next, _args, ctx) {
			ctx.sendAt("inc", [], (pb) => pb.item("items", 0));
		},
		touch(next) {
			next.items[0].selected = 1;
		},
	});
	queueEvents("poke", "touch");
	drain();
	assert.equal(host.rootComponent.items[0].count, 1);
	assert.deepEqual(
		notices.filter(({ type }) => type === "stale"),
		[],
	);
});

test("an ask from a transaction that fails is never started", () => {
	let started = 0;
	const { host, queueEvents, drain } = setup({
		queue(_next, _args, ctx) {
			ctx.ask("load");
			throw new Error("asker failed");
		},
	});
	host.scope.registerAskHandlers({
		load: () => {
			started += 1;
			return "result";
		},
	});
	queueEvents("queue");
	drain();
	assert.equal(started, 0);
});

test("an answer handler reads the request it answers; a message named like it isn't an answer", () => {
	const seen = [];
	const { host, notices, queueEvents, drain } = setup(
		{
			queue(_next, _args, ctx) {
				ctx.sendAt("request", [], (pb) => pb.item("items", 0));
			},
			fake(_next, _args, ctx) {
				ctx.sendAt("load.ok", ["forged"], (pb) => pb.item("items", 0));
			},
		},
		{
			request(_next, _args, ctx) {
				seen.push(["asked", ctx.ask("load"), ctx.ask("load")]);
			},
			answers: {
				load: {
					ok(next, [r], ctx) {
						seen.push(["answered", ctx.request, r]);
						next.reply = r;
					},
				},
			},
		},
	);
	host.scope.registerAskHandlers({ load: () => "result" });
	queueEvents("queue");
	drain();
	const [[, first, second], ...answered] = seen;
	assert.notEqual(first, second);
	assert.deepEqual(answered, [
		["answered", first, "result"],
		["answered", second, "result"],
	]);
	const warn = console.warn;
	console.warn = () => {};
	try {
		queueEvents("fake");
		drain();
	} finally {
		console.warn = warn;
	}
	assert.equal(host.rootComponent.items[0].reply, "result");
	assert.ok(notices.some(({ type, message }) => type === "unhandled" && message === "load.ok"));
});
