import { step, stories } from "../../src/storybook/index.js";
import {
	at,
	field,
	HOST,
	inst,
	list,
	notify,
	obs,
	request,
	response,
	send,
	state,
} from "./fixtures.js";
import { treeSpecComponents } from "./index.js";
import { explorerOf, worldOf } from "./model.js";

// An item asked for something, and its place got a new item before the answer arrived.
const replaced = state({
	tree: inst("Items", 0, { slots: [list("items", inst("Item", 3, { locals: { label: 20 } }))] }),
	inflight: [response("fetch", 2, "ok 100", at(0), at(1, "items[0]"))],
	obs: [obs("requested", "request 2 sent"), obs("answered", "request 2 answered: ok 100")],
});

// A counter's notification and request bubbling through a panel to the app, a reply on its way.
const bubbling = state({
	tree: inst("App", 0, {
		slots: [
			field(
				"panel",
				inst("Panel", 1, { slots: [field("c", inst("Counter", 2, { locals: { n: 1 } }))] }),
			),
		],
	}),
	queue: [
		notify("changed", at(2, "panel", "c"), at(2, "panel", "c"), [1]),
		request("total", 3, at(2, "panel", "c"), at(2, "panel", "c"), { args: [1] }),
		send("seen", at(1, "panel"), at(2, "panel", "c"), ['"panel"']),
	],
});

// Every kind of place: a field, a list with a cleared item, and an instance in a control state.
const places = state({
	tree: inst("Board", 0, {
		slots: [
			list(
				"groups",
				inst("Group", 1, { slots: [field("item", inst("Item", 2))] }),
				null,
				inst("Loader", 4, { control: "loading" }),
			),
		],
	}),
	inflight: [response("fetch", 5, "ok 1", HOST, at(4, "groups[2]"), { urgent: true })],
	quiescent: false,
});

// A two-state scenario: one ping, one reply.
const pingPong = {
	name: "ping",
	tier: "M0",
	title: "A ping and its reply",
	blurb: "The host pings the root, which replies.",
	policy: "by-path",
	gran: "turn",
	kinds: ["(kind Root (state) () ((on (send ping) () ((reply pong)))))"],
	host: "(host ())",
	states: [
		state({ tree: inst("Root", 0), script: ["ping()"] }),
		state({
			tree: inst("Root", 0),
			queue: [send("pong", at(0), HOST)],
			obs: [obs("deliver", "send ping delivered to #0")],
		}),
		state({
			tree: inst("Root", 0),
			obs: [
				obs("deliver", "send ping delivered to #0"),
				obs("ignored", "the host has no handler for send pong"),
			],
			quiescent: true,
		}),
	],
	edges: [
		{ from: 0, to: 1, rule: "env", label: "event: ping()" },
		{ from: 1, to: 2, rule: "run", label: "run: send pong" },
	],
};

export default stories({
	title: "Tree spec",
	components: treeSpecComponents,
	stories: {
		"World/Replaced while asking, by path": { make: (C) => worldOf(C, replaced, "by-path") },
		"World/Replaced while asking, by identity": {
			make: (C) => worldOf(C, replaced, "by-identity"),
		},
		"World/Bubbling": {
			make: (C) => worldOf(C, bubbling, "by-path"),
			sequences: {
				"select the counter": [
					step.event("click", ".ts-instance .ts-instance .ts-instance > g.cursor-pointer"),
					step.check("selected", (s) => s.selected === 2),
				],
			},
		},
		"World/Fields, lists, cleared places and control states": {
			make: (C) => worldOf(C, places, "by-identity"),
		},
		"Explorer/Ping and reply": {
			make: (C) => explorerOf(C, pingPong),
			sequences: {
				"step to the end, then back": [
					step.event("click", "section button.btn-outline"),
					step.check("at the reply", (s) => s.current === 1),
					step.event("click", "section button.btn-outline"),
					step.check("done", (s) => s.current === 2),
					step.event("click", "section button"),
					step.check("back one", (s) => s.current === 1),
				],
			},
		},
	},
});
