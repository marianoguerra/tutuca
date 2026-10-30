// Delivery as spec/tree models it: an address is a path and the identity it reached, every
// message carries its sender's, so any handler can reply, and a DOM event runs ahead of the queue.
import assert from "node:assert/strict";
import test from "node:test";
import {
	component,
	DispatchPath,
	field,
	HOST,
	h,
	render,
	send,
	Target,
	Task,
	t,
} from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const setup = () => {
	let C = null;
	const Leaf = component({
		name: "Leaf",
		fields: { got: t.any() },
		views: {
			main: h(
				"div",
				{},
				h("button", { id: "go", "on:click": send("go") }, "go"),
				h("button", { id: "swap", "on:click": send("swap") }, "swap"),
				h("button", { id: "answer", "on:click": send("answer") }, "answer"),
			),
		},
		on: {
			go(_next, _args, ctx) {
				ctx.notify("hello");
			},
			// Notifies, and turns into a new leaf in the same transaction.
			swap(_next, _args, ctx) {
				ctx.notify("hello");
				return C.Leaf({ got: "swapped" });
			},
			answer(_next, _args, ctx) {
				ctx.reply("hi", ["to the host"]);
			},
			hi(next, [v]) {
				next.got = v;
			},
		},
	});
	const Middle = component({
		name: "Middle",
		fields: { leaf: t.component("Leaf") },
		views: { main: render(field("leaf")) },
	});
	const Top = component({
		name: "Top",
		fields: { middle: t.component("Middle"), log: t.array(), renew: t.any() },
		views: {
			main: h(
				"div",
				{},
				h("button", { id: "ev", "on:click": send("ev") }, "ev"),
				render(field("middle")),
			),
		},
		on: {
			hello(next, _args, ctx) {
				next.log.push("hello");
				ctx.reply("hi", ["from top"]);
				ctx.stopNext();
				if (next.renew !== null) next.middle.leaf = C.Leaf({ got: next.renew });
			},
			ev(next) {
				next.log.push("ev");
			},
			mark(next) {
				next.log.push("mark");
			},
		},
	});
	const reports = [];
	const onReport = (type, info) => reports.push({ type, ...info });
	const s = setupHost({ Leaf, Middle, Top }, { sync: true, onReport });
	C = s.C;
	const warn = console.warn;
	const click = (id) => {
		console.warn = () => {};
		try {
			s.click(s.rootNode.querySelector(`#${id}`));
		} finally {
			console.warn = warn;
		}
	};
	const of = (type) => reports.filter((r) => r.type === type).map((r) => r.message ?? r.task.name);
	return { ...s, click, of, reports };
};

test("a reply from any hop of a notification reaches the component that notified", () => {
	const { host, C, click, failures } = setup();
	host.start(C.Top({ renew: null }));
	click("go");
	assert.deepEqual(host.rootComponent.log, ["hello"]);
	assert.equal(host.rootComponent.middle.leaf.got, "from top");
	assert.deepEqual(failures, []);
});

test("a reply to a sender replaced since it sent is dropped as stale (spec/tree M4)", () => {
	const { host, C, click, of } = setup();
	host.start(C.Top({ renew: "new" }));
	click("go");
	assert.equal(host.rootComponent.middle.leaf.got, "new", "the new leaf doesn't get it");
	assert.deepEqual(of("stale"), ["hi"]);
});

test("a notification whose sender replaced itself is stale before it bubbles (spec/tree M6)", () => {
	const { host, C, click, of } = setup();
	host.start(C.Top({ renew: null }));
	click("swap");
	assert.deepEqual(host.rootComponent.log, []);
	assert.equal(host.rootComponent.middle.leaf.got, "swapped");
	assert.deepEqual(of("stale"), ["hello"]);
});

test("a reply to the host, which has no handlers, is reported unhandled", () => {
	const { host, C, click, of, failures } = setup();
	host.start(C.Top({ renew: null }));
	click("answer");
	assert.equal(host.rootComponent.middle.leaf.got, null);
	assert.deepEqual(of("unhandled"), ["hi"]);
	assert.deepEqual(failures, []);
});

test("a DOM event runs ahead of the queue, after the events before it", () => {
	const { host, C, rootNode, drain } = setup();
	host.start(C.Top({ renew: null }));
	const mark = new Task("mark", [], HOST, new Target(new DispatchPath()), null);
	host.prepareTask(mark, host.rootComponent);
	host.pushTask(mark);
	const handleTasks = host.handleTasks;
	host.handleTasks = () => {};
	host.handleEvent({ type: "click", target: rootNode.querySelector("#ev") });
	host.handleEvent({ type: "click", target: rootNode.querySelector("#go") });
	host.handleTasks = handleTasks;
	drain();
	// ev and go ran before mark; go's notification was queued behind mark.
	assert.deepEqual(host.rootComponent.log, ["ev", "mark", "hello"]);
});
