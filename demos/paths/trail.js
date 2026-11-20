// The trail: what went through each place of the tree, kept across events. Every event the
// tour goes through leaves entries (trace.js's entriesOf) at the places it touched: where it
// happened, the places its walk went up through, where each message it led to was handled and
// where a notification passed. The tree's rows count them and a Probe shows the ones at one
// place.
//
// Agents stand on the tree. As in the canvas, the Agent (components/agent) holds the session,
// its transcript and its model; what it drives is a Probe of its own, which holds who it is
// (a name, a mark, the profile it was placed with) and where: its base, the place it was put
// at, where what it's asked to change goes, and the place it's at now, which its tools move.
// Its tools read a place (its state, its specification, what went through it), move, run one of
// the component's queries at a place (queryApp) and send it one of its messages (sendToApp),
// the one it's at or its base, which the host runs on the app. They also list the other agents
// and tell one something: the trail leaves it in that agent's probe, and its Agent reads it as
// a message of the user's, once it's done with what it was doing.
import { agentComponents } from "../../components/agent/index.js";
import { transcriptComponents } from "../../components/llm/transcript.js";
import { AGENT_META, agentTool, typeSchema } from "../../src/meta/index.js";
import { plainOf } from "../../src/tree/record.js";
import {
	$if,
	component,
	contractOf,
	each,
	field,
	render,
	send,
	seqItem,
	sourceKey,
	specOf,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { profileOf } from "./profiles.js";
import { KIND_TEXT, KINDS, NO_COUNTS, tourComponents } from "./tree.js";

const { button, code, div, form, header, input, li, ol, option, p, pre, select, span } = tag;

// The entries the trail keeps: the oldest go first.
const MAX_ENTRIES = 500;
// The most of a place's state an agent is told at once, and the entries a list has when no
// limit is given.
const MAX_STATE = 1500;
const LIMIT = 20;
const ALL_KINDS = [...KINDS, "all"];

// How many entries of each kind each place has: { [key]: { event, walk, passed, handled, other } }.
const countsOf = (log) => {
	const counts = {};
	for (const { key, kind } of log) {
		counts[key] ??= { ...NO_COUNTS };
		counts[key][kind] += 1;
	}
	return counts;
};

const schemas = (types) => (types === undefined ? "not declared" : types.map(typeSchema));
// What the component instance is specified as, as data: its fields' types, its messages and
// queries with their args' types (when they declare them), what it notifies and its views.
const specData = (instance) => {
	const spec = specOf(instance);
	const contract = contractOf(instance);
	return {
		component: contract.name,
		fields: Object.fromEntries(
			Object.entries(spec.fields).map(([name, type]) => [name, typeSchema(type)]),
		),
		messages: contract.messages.map((m) => ({ name: m.name, pure: m.pure, args: schemas(m.args) })),
		queries: contract.queries.map((q) => ({ name: q.name, args: schemas(q.args) })),
		notifies: contract.notifies,
		views: Object.keys(spec.views ?? {}),
	};
};

// The places of a tree, from its rows (tree.js's rowsOf): { [key]: { key, parent, children,
// label, comp, state, spec } }, parent and children keys, state the component there as data and
// spec what it's specified as; a place that renders no component has neither.
export const nodesOf = (rows) => {
	const nodes = {};
	for (const { row, instance, label, parent } of rows) {
		if (row.key === "" || nodes[row.key] !== undefined) continue;
		const spec = instance === null ? null : specData(instance);
		nodes[row.key] = {
			key: row.key,
			parent,
			children: [],
			label,
			comp: spec?.component ?? "",
			state: instance === null ? null : plainOf(instance),
			spec,
		};
	}
	for (const node of Object.values(nodes)) {
		if (node.key !== node.parent) nodes[node.parent]?.children.push(node.key);
	}
	return nodes;
};

const argsText = (args) => (args ?? []).map((arg) => JSON.stringify(arg)).join(", ");
// What an entry was and what became of it.
const entryText = (entry) => {
	const call = `${entry.name}(${argsText(entry.args)})`;
	if (entry.kind === "event") return `${entry.eventType} → ${call}`;
	if (entry.kind === "walk") return `${entry.eventType} at ${entry.to} → ${call}, walking up`;
	return `${entry.mode} ${call} from ${entry.from}: ${entry.outcome}`;
};
const entryLine = (entry) => `#${entry.n} ${entryText(entry)}`;
const nameOf = (node) => (node.comp === "" ? node.label : `${node.label} (${node.comp})`);
const countsText = (counts) => KINDS.map((kind) => `${counts[kind]} ${KIND_TEXT[kind]}`).join(", ");
const countsShort = (counts) => KINDS.map((kind) => counts[kind]).join("/");
const listText = (names) => (names.length === 0 ? "none" : names.join(", "));
const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max)}… (cut)`);
const isKind = (entry, kind) => kind === "all" || entry.kind === kind;
const GONE = "That place is no longer in the tree.";
// The place of a probe that where says: the base's, else the current one's; null when gone.
const placeAt = (probe, where) => probe.nodes[where === "base" ? probe.base : probe.at] ?? null;
const entriesAt = (probe, key) => probe.log.filter((entry) => entry.key === key);
const labelOf = (nodes, key) => nodes[key]?.label ?? "a place no longer in the tree";

const PROMPT = `You stand on the component tree of a running web application. You have a base, the
place you were put at, which never changes, and a current place, which your tools move: up, down,
go_to a path, home to the base. Paths are written as here writes them: · is the root, .cart
.lines[0] the first of the cart's lines.

Every place keeps what went through it, as numbered entries of five kinds: event (a DOM event
whose path ended there), walk (an event further down, reading its path up through there), passed
(a notification that went up through there with no handler), handled (a message or notification
handled there) and other (one that failed or wasn't delivered). entries lists them, entry gives
one in full and trace everything its event did, at every place.

Every tool that reads a place, query and send take where: "current" (the default) or "base".
state is what the component holds; to read what it works out from that (a total, whether it's
empty), run one of its queries with query (spec says which it has and what they take). To
change something, send the component at a place one of its messages (spec says which it has);
send answers with what the message did and the state there after. A change you're asked for
without being told where is for your base: send it with where "base", wherever you are.

You may not be alone: agents lists the other agents on the tree, with their bases and where
they are, and tell sends one a message, which it reads as "Message from <name>: …" once it's done
with what it's doing. Before you change a place another agent is based at or is working on, tell
it what you're about to do. Answer a message that asks you something with tell; one that asks
nothing needs no answer.`;

const whereType = () => t.option(t.enum(["current", "base"]));

// A place in the tree, with what went through it: the inspector's, and each agent's.
const Probe = component({
	name: "Probe",
	meta: {
		[AGENT_META]: {
			prompt: PROMPT,
			summary: "here",
			instructions: "instructions",
			// Reading a place, moving and telling others take a step each: more than the 12 an agent
			// gets by default.
			maxSteps: 50,
			tools: [
				agentTool(
					"here",
					"query",
					[],
					"Who and where you are: your base, the place you're at with its state and counts, what's above and below, who else is there.",
				),
				agentTool(
					"spec",
					"query",
					["where"],
					"The specification of the component at a place: its fields, messages, queries, what it notifies, its views.",
				),
				agentTool("state", "query", ["where"], "The whole state of the component at a place."),
				agentTool(
					"entries",
					"query",
					["kind", "limit", "where"],
					"The newest entries of a kind at a place, a line each. kind: event, walk, passed, handled, other or all. limit: how many, 20 when null.",
				),
				agentTool("entry", "query", ["n"], "An entry in full, by its number (#n)."),
				agentTool(
					"trace",
					"query",
					["n"],
					"Everything the event or sent message of entry #n did, at every place, in order.",
				),
				agentTool(
					"busiest",
					"query",
					["kind"],
					"The five places with most entries of a kind (or all), with their paths.",
				),
				agentTool("agents", "query", [], "The other agents on the tree, and where each is."),
				agentTool(
					"tell",
					"message",
					["name", "text"],
					"Send another agent, by its name, a message: it reads it once it's done with what it's doing.",
					{ result: "told" },
				),
				agentTool("up", "message", [], "Move to the place above."),
				agentTool("down", "message", ["child"], "Move to a place below, by its number in here."),
				agentTool("go_to", "message", ["path"], "Move to a place by its path.", {
					target: "goTo",
				}),
				agentTool("home", "message", [], "Move back to your base."),
				agentTool(
					"query",
					"message",
					["name", "args", "where"],
					"Run one of the queries of the component at a place, with args as an array ([] for one that takes none), and answer what it returns. Changes nothing.",
					{ target: "runQuery", result: "answered" },
				),
				agentTool(
					"send",
					"message",
					["name", "args", "where"],
					"Send the component at a place one of its messages, with args as an array. Changes the application.",
					{ target: "sendMessage", result: "sent" },
				),
			],
		},
	},
	fields: {
		at: t.string(), // The place it's at, by its key (regions.js's pathKey); "" for none yet.
		base: t.string(), // An agent's: the place it was put at.
		name: t.string(), // An agent's name and mark, the profile it has and what that tells it.
		icon: t.string(),
		profile: t.string(),
		brief: t.string(),
		others: t.any({ default: [] }), // The other agents: [{ name, icon, profile, base, at, atKey }].
		// What other agents told it and it hasn't read yet, the oldest first.
		inbox: t.array(t.record({ from: t.string(), text: t.string() })),
		lastTold: t.string(), // What became of the last message it sent another agent.
		lastSent: t.string(), // What became of the last message it sent.
		lastAnswer: t.string(), // What the last query it ran returned.
		nodes: t.any({ default: {} }), // nodesOf's.
		log: t.any({ default: [] }), // Every entry of the trail.
		kind: t.string(), // The kind whose entries are listed; "" for none.
		open: t.number({ default: -1 }), // The entry shown in full, by its n; -1 for none.
	},
	queries: {
		get node() {
			return this.nodes[this.at] ?? null;
		},
		get hasNode() {
			return this.node !== null;
		},
		get isEmpty() {
			return this.at === "";
		},
		get isGone() {
			return this.at !== "" && this.node === null;
		},
		get label() {
			return this.node?.label ?? "";
		},
		get comp() {
			return this.node?.comp ?? "";
		},
		get counts() {
			return countsOf(entriesAt(this, this.at))[this.at] ?? NO_COUNTS;
		},
		get chips() {
			return KINDS.map((kind) => ({
				text: `${this.counts[kind]} ${KIND_TEXT[kind]}`,
				tone: `trail-chip pt-count-${kind}${this.counts[kind] === 0 ? " pt-zero" : ""}`,
				pressed: kind === this.kind ? "true" : "false",
			}));
		},
		get hasKind() {
			return this.kind !== "";
		},
		// The entries of the open kind, newest first.
		get shown() {
			return entriesAt(this, this.at)
				.filter((entry) => entry.kind === this.kind)
				.reverse()
				.map((entry) => ({
					n: entry.n,
					line: entryLine(entry),
					isOpen: entry.n === this.open,
					detail: JSON.stringify(detailOf(entry), null, 2),
				}));
		},
		get hasShown() {
			return this.shown.length > 0;
		},
		// What its profile tells it, in every system prompt.
		get instructions() {
			return this.brief;
		},
		// What answers its tell tool.
		get told() {
			return this.lastTold;
		},
		// What it was told and hasn't read, as its agent reads it (components/agent's mail); ""
		// for nothing.
		get mail() {
			return this.inbox.map(({ from, text }) => `Message from ${from}: ${text}`).join("\n\n");
		},
		// What answers its send tool.
		get sent() {
			return this.lastSent;
		},
		// What answers its query tool.
		get answered() {
			return this.lastAnswer;
		},
		// Where it is, for the agent: in every system prompt, and what answers a move.
		get here() {
			const who = this.name === "" ? "" : `You are ${this.name}, a ${this.profile}.`;
			const { node } = this;
			if (node === null) {
				return [who, this.at === "" ? "You aren't anywhere yet." : GONE].filter(Boolean).join("\n");
			}
			const where =
				this.base === "" || this.base === this.at
					? `You are at ${this.base === "" ? "" : "your base, "}${nameOf(node)}.`
					: `Your base is ${labelOf(this.nodes, this.base)}. You are now at ${nameOf(node)}.`;
			const parent = this.nodes[node.parent] ?? null;
			const children = node.children.map((key) => this.nodes[key]).filter(Boolean);
			const counts = countsOf(this.log);
			const below = children.map(
				(child, i) =>
					`  ${i + 1}. ${nameOf(child)}: ${countsShort(counts[child.key] ?? NO_COUNTS)}`,
			);
			const beside = this.others.filter((other) => other.atKey === this.at);
			const lines = [
				who,
				where,
				`State: ${node.state === null ? "none, no component is rendered here" : clip(JSON.stringify(node.state), MAX_STATE)}`,
				node.spec === null
					? ""
					: `Messages: ${listText(node.spec.messages.map((m) => m.name))}. Queries: ${listText(node.spec.queries.map((q) => q.name))}. Notifies: ${listText(node.spec.notifies)}.`,
				`Here: ${countsText(this.counts)}.`,
				parent === null ? "Up: nothing, this is the root." : `Up: ${nameOf(parent)}.`,
				below.length === 0
					? "Down: nothing."
					: `Down, each with its counts as ${KINDS.join("/")}:\n${below.join("\n")}`,
				beside.length === 0 ? "" : `Also here: ${beside.map((other) => other.name).join(", ")}.`,
			];
			return lines.filter((line) => line !== "").join("\n");
		},
		spec: {
			args: [whereType()],
			run(where) {
				const node = placeAt(this, where);
				if (node === null) return GONE;
				if (node.spec === null) return `${node.label} renders no component.`;
				return JSON.stringify({ at: node.label, ...node.spec }, null, 2);
			},
		},
		state: {
			args: [whereType()],
			run(where) {
				const node = placeAt(this, where);
				if (node === null) return GONE;
				if (node.state === null) return `${node.label} renders no component.`;
				return JSON.stringify(node.state, null, 2);
			},
		},
		entries: {
			args: [t.enum(ALL_KINDS), t.option(t.int({ min: 1 })), whereType()],
			run(kind, limit, where) {
				const node = placeAt(this, where);
				if (node === null) return GONE;
				const found = entriesAt(this, node.key).filter((entry) => isKind(entry, kind));
				if (found.length === 0) return `No ${kind} entries at ${node.label}.`;
				const lines = found.slice(-(limit ?? LIMIT)).map(entryLine);
				const more = found.length - lines.length;
				return more > 0 ? `${lines.join("\n")}\n(${more} older ones not shown)` : lines.join("\n");
			},
		},
		entry: {
			args: [t.int({ min: 1 })],
			run(n) {
				const entry = this.log.find((e) => e.n === n);
				if (entry === undefined) return `There's no entry #${n}.`;
				const at = labelOf(this.nodes, entry.key);
				return JSON.stringify({ at, ...detailOf(entry) }, null, 2);
			},
		},
		trace: {
			args: [t.int({ min: 1 })],
			run(n) {
				const entry = this.log.find((e) => e.n === n);
				if (entry === undefined) return `There's no entry #${n}.`;
				return this.log
					.filter((e) => e.click === entry.click)
					.map((e) => `#${e.n} at ${labelOf(this.nodes, e.key)}: ${entryText(e)}`)
					.join("\n");
			},
		},
		busiest: {
			args: [t.enum(ALL_KINDS)],
			run(kind) {
				const totals = {};
				for (const entry of this.log) {
					if (isKind(entry, kind)) totals[entry.key] = (totals[entry.key] ?? 0) + 1;
				}
				const top = Object.entries(totals)
					.filter(([key]) => this.nodes[key] !== undefined)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 5);
				if (top.length === 0) return `No ${kind} entries anywhere.`;
				return top.map(([key, total]) => `${total} at ${nameOf(this.nodes[key])}`).join("\n");
			},
		},
		get agents() {
			if (this.others.length === 0) return "There are no other agents.";
			return this.others
				.map((o) => `${o.name}, a ${o.profile}: based at ${o.base}, now at ${o.at}`)
				.join("\n");
		},
	},
	view: div(
		{ class: "trail-probe" },
		$if(
			field("isEmpty"),
			p({ class: "trail-hint" }, "Click a row to see what went through it."),
			"",
		),
		$if(field("isGone"), p({ class: "trail-hint" }, "This place is no longer in the tree."), ""),
		$if(
			field("hasNode"),
			div(
				{ class: "trail-place" },
				header(
					{ class: "trail-head" },
					span({ class: "trail-label" }, field("label")),
					span({ class: "pt-comp" }, field("comp")),
				),
				div(
					{ class: "trail-chips" },
					each(
						field("chips"),
						button(
							{
								class: field("tone"),
								type: "button",
								"aria-pressed": field("pressed"),
								"on:click": send("pickKind", sourceKey()),
							},
							field("text"),
						),
					),
				),
				$if(
					field("hasKind"),
					$if(
						field("hasShown"),
						ol(
							{ class: "trail-entries" },
							each(
								field("shown"),
								li(
									{ class: "trail-entry" },
									button(
										{
											class: "trail-line",
											type: "button",
											"aria-expanded": $if(field("isOpen"), "true", "false"),
											"on:click": send("toggle", sourceKey()),
										},
										field("line"),
									),
									$if(field("isOpen"), pre({ class: "trail-detail" }, code(field("detail"))), ""),
								),
							),
						),
						p({ class: "trail-hint" }, "None so far."),
					),
					"",
				),
			),
			"",
		),
	),
	on: {
		// A chip: lists its kind's entries, or closes the list when it's the open one.
		pickKind: {
			args: [t.int({ min: 0 })],
			run(next, [index]) {
				const kind = KINDS[index] ?? "";
				next.kind = kind === this.kind ? "" : kind;
				next.open = -1;
			},
		},
		// An entry's line: shows it in full, or closes it.
		toggle: {
			args: [t.int({ min: 0 })],
			run(next, [index]) {
				const n = this.shown[index]?.n ?? -1;
				next.open = n === this.open ? -1 : n;
			},
		},
		up: {
			args: [],
			emits: { notify: ["moved"] },
			pre: (self) => self.hasNode && self.nodes[self.node.parent] !== undefined,
			why: (self) => (self.hasNode ? "This is the root: there's nothing above it." : GONE),
			run(next, _args, ctx) {
				next.at = this.node.parent;
				next.open = -1;
				ctx.notify("moved");
			},
		},
		down: {
			args: [t.int({ min: 1 })],
			emits: { notify: ["moved"] },
			pre: (self, [child]) => self.hasNode && child <= self.node.children.length,
			why: (self, [child]) =>
				self.hasNode
					? `There's no place ${child} below: there are ${self.node.children.length}.`
					: GONE,
			run(next, [child], ctx) {
				next.at = this.node.children[child - 1];
				next.open = -1;
				ctx.notify("moved");
			},
		},
		goTo: {
			args: [t.string({ minLength: 1 })],
			emits: { notify: ["moved"] },
			pre: (self, [path]) => keyOfLabel(self.nodes, path) !== null,
			why(self, [path]) {
				const labels = Object.values(self.nodes).map((node) => node.label);
				const near = labels.filter((label) => label.includes(path.trim()));
				const some = (near.length > 0 ? near : labels).slice(0, 12);
				return `There's no place ${path}. ${near.length > 0 ? "Did you mean" : "There are"}: ${some.join(", ")}`;
			},
			run(next, [path], ctx) {
				next.at = keyOfLabel(this.nodes, path);
				next.open = -1;
				ctx.notify("moved");
			},
		},
		home: {
			args: [],
			emits: { notify: ["moved"] },
			pre: (self) => self.nodes[self.base] !== undefined,
			why: () => "Your base is no longer in the tree.",
			run(next, _args, ctx) {
				next.at = this.base;
				next.open = -1;
				ctx.notify("moved");
			},
		},
		// A message for another agent, which the trail leaves in its inbox.
		tell: {
			args: [t.string({ minLength: 1 }), t.string({ minLength: 1 })],
			emits: { notify: ["told"] },
			pre: (self, [name]) => self.others.some((other) => other.name === name),
			why(self, [name]) {
				if (name === self.name) return "That's you: tell another agent.";
				if (self.others.length === 0) return "There are no other agents to tell.";
				return `There's no agent ${name}. There are: ${self.others.map((o) => o.name).join(", ")}.`;
			},
			run(next, [name, text], ctx) {
				next.lastTold = `Told ${name}. It reads it once it's done with what it's doing; what it answers, if anything, comes to you as a message.`;
				ctx.notify("told", [name, this.name, text]);
			},
		},
		// Its agent read what was in the inbox.
		takeMail: {
			pure: true,
			args: [],
			run(next) {
				next.inbox = [];
			},
		},
		// A query of the component at the place where says: the host runs it on the app and
		// answers with what it returned.
		runQuery: {
			args: [t.string({ minLength: 1 }), t.array(t.any()), whereType()],
			emits: { ask: ["queryApp"] },
			pre: (self, [name, _args, where]) =>
				placeAt(self, where)?.spec?.queries.some((q) => q.name === name) === true,
			why(self, [name, _args, where]) {
				const node = placeAt(self, where);
				if (node === null) return GONE;
				const { spec } = node;
				if (spec === null) return `There's no component at ${node.label} to query.`;
				return `${spec.component} at ${node.label} has no query ${name}; it has: ${listText(spec.queries.map((q) => q.name))}.`;
			},
			run(next, [name, args, where], ctx) {
				next.lastAnswer = "";
				ctx.ask("queryApp", [placeAt(this, where).key, name, args]);
			},
		},
		// A message for the component at the place where says: the host runs it on the app and
		// answers with what it did.
		sendMessage: {
			args: [t.string({ minLength: 1 }), t.array(t.any()), whereType()],
			emits: { ask: ["sendToApp"] },
			pre: (self, [name, _args, where]) =>
				placeAt(self, where)?.spec?.messages.some((m) => m.name === name) === true,
			why(self, [name, _args, where]) {
				const node = placeAt(self, where);
				if (node === null) return GONE;
				const { spec } = node;
				if (spec === null) return `There's no component at ${node.label} to send it to.`;
				return `${spec.component} at ${node.label} has no message ${name}; it has: ${listText(spec.messages.map((m) => m.name))}.`;
			},
			run(next, [name, args, where], ctx) {
				next.lastSent = "";
				ctx.ask("sendToApp", [placeAt(this, where).key, name, args, this.name]);
			},
		},
	},
	answers: {
		// { value, error }: what the query returned, or why it didn't run.
		queryApp: {
			ok(next, [result]) {
				next.lastAnswer = result?.error
					? `It didn't run: ${result.error}`
					: clip(JSON.stringify(result?.value ?? null), MAX_STATE);
			},
			error(next, [error]) {
				next.lastAnswer = `It didn't run: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.lastAnswer = "It didn't run: this page can't run the application's queries.";
			},
		},
		// { entries, state, error }: what the message left at each place it went (trace.js's
		// sentEntriesOf), the state where it was sent after, or why it wasn't sent.
		sendToApp: {
			ok: {
				run(next, [result], ctx) {
					if (result?.error) {
						next.lastSent = `It wasn't sent: ${result.error}`;
						return;
					}
					const entries = result?.entries ?? [];
					next.lastSent = [
						"Sent. What it did, in order:",
						...entries.map((entry) => `  at ${entry.to}: ${entryText(entry)}`),
						`State there now: ${clip(JSON.stringify(result?.state ?? null), MAX_STATE)}`,
					].join("\n");
					if (entries.length > 0) ctx.notify("record", [entries]);
				},
			},
			error(next, [error]) {
				next.lastSent = `It wasn't sent: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.lastSent = "It wasn't sent: this page can't send messages to the application.";
			},
		},
	},
});

// The key of the place whose path is written as label, or null.
const keyOfLabel = (nodes, label) =>
	Object.values(nodes).find((node) => node.label === String(label).trim())?.key ?? null;

// An entry as it's shown in full: all of it but the key, which the place's label says better.
const detailOf = ({ key: _key, n, click, kind, mode, name, args, ...rest }) => ({
	n,
	click,
	kind,
	mode,
	name,
	args,
	...rest,
});

const NO_MARKS = [];
// What a handler leaves in step with the trail's log, nodes and agents: the rows' counts and
// marks, and what every probe reads.
const settle = (next, log, nodes) => {
	const counts = countsOf(log);
	const probes = next.agents.map((agent) => agent.target);
	const marks = probes.map(({ name, icon, at, base }) => ({ name, icon, at, base }));
	const selected = next.inspector.at;
	const pick = (found) =>
		found.length === 0 ? NO_MARKS : found.map(({ name, icon }) => ({ name, icon }));
	for (const row of next.tree.rows) {
		if (row.key === "") continue;
		row.counts = counts[row.key] ?? NO_COUNTS;
		row.agents = pick(marks.filter((mark) => mark.at === row.key));
		row.bases = pick(marks.filter((mark) => mark.base === row.key && mark.at !== row.key));
		row.selected = row.key === selected;
	}
	next.inspector.nodes = nodes;
	next.inspector.log = log;
	const about = probes.map((probe) => ({
		name: probe.name,
		icon: probe.icon,
		profile: probe.profile,
		base: labelOf(nodes, probe.base),
		at: labelOf(nodes, probe.at),
		atKey: probe.at,
	}));
	probes.forEach((probe, i) => {
		probe.nodes = nodes;
		probe.log = log;
		probe.others = about.filter((_, j) => j !== i);
	});
};

// A new agent at the place being placed, named found ({ name, icon }), with the profile picked
// and the model new agents start with.
const place = (self, next, ctx, found) => {
	const C = ctx.scope.components;
	const profile = profileOf(self.profile, self.profiles);
	const target = C.Probe({
		at: self.placing,
		base: self.placing,
		name: found.name,
		icon: found.icon,
		profile: profile?.title ?? "",
		brief: profile?.prompt ?? "",
		nodes: self.nodes,
		log: self.log,
	});
	const fields = {
		target,
		transcript: C.Transcript({ messages: [] }),
		canChange: false,
		models: self.models,
		modelsAsked: true,
	};
	if (self.model !== "") Object.assign(fields, { model: self.model, modelFrom: "given" });
	next.agents.push(C.Agent(fields));
	next.current = self.agents.length;
	next.placing = "";
	next.nameProblem = "";
	settle(next, self.log, self.nodes);
};

// The tree, the inspector of the place picked in it, and the agents on it.
const Trail = component({
	name: "Trail",
	fields: {
		tree: t.component("TourTree"),
		inspector: t.component("Probe"),
		agents: t.array(t.component("Agent")),
		current: t.int({ min: 0 }), // The agent shown, by its index.
		log: t.any({ default: [] }),
		nodes: t.any({ default: {} }),
		seen: t.number(), // How many entries there were so far: the last one's n.
		// Whether the host has models to ask (its answer to models, asked by checkInference),
		// which they are ([{ id: "provider/id", name }]) and the one new agents start with: the
		// first, then the last one picked; "" for the echo model.
		inference: t.enum(["unknown", "none", "ready"]),
		models: t.array(t.record({ id: t.string(), name: t.string() })),
		model: t.string(),
		// What an agent can be placed as (the host's answer to agentProfiles) and the one picked.
		profiles: t.any({ default: [] }),
		profile: t.string(),
		placing: t.string(), // The place an agent is being put at, while it gets its name.
		renaming: t.boolean(), // Whether the current agent's name is being changed.
		nameDraft: t.string(), // The name typed for it so far.
		nameProblem: t.string(), // Why the name typed for the current agent wasn't taken.
	},
	queries: {
		get hasAgents() {
			return this.agents.length > 0;
		},
		get hasLog() {
			return this.log.length > 0;
		},
		get shown() {
			return this.agents[this.current]?.target ?? null;
		},
		get tabs() {
			return this.agents.map(({ target }, i) => ({
				text: `${target.icon} ${target.name}`,
				pressed: i === this.current ? "true" : "false",
			}));
		},
		get currentName() {
			return this.shown?.name ?? "";
		},
		get currentAbout() {
			const probe = this.shown;
			return probe === null ? "" : `${probe.profile} · based at ${labelOf(this.nodes, probe.base)}`;
		},
		get hasNameProblem() {
			return this.nameProblem !== "";
		},
		get inferenceText() {
			if (this.inference === "unknown") return "Looking for the inference server…";
			if (this.inference === "none") {
				return "No inference server: agents use the echo model, which runs the tool you name, /tool {json}.";
			}
			const n = this.models.length;
			return `${n} ${n === 1 ? "model" : "models"} from the inference server.`;
		},
		get profileOptions() {
			return this.profiles.map(({ id, title, icon }) => ({
				id,
				text: `${icon} ${title}`,
				selected: id === this.profile,
			}));
		},
		get cannotAdd() {
			return !this.inspector.hasNode || this.placing !== "";
		},
		get addText() {
			return this.inspector.hasNode
				? `Add agent at ${this.inspector.label}`
				: "Click a row to place an agent";
		},
	},
	view: div(
		{ class: "trail" },
		render(field("tree")),
		div(
			{ class: "trail-panel" },
			header(
				{ class: "trail-title" },
				span("What went through"),
				$if(
					field("hasLog"),
					button(
						{
							class: "trail-button trail-reset",
							type: "button",
							title: "Forget every entry",
							"on:click": send("reset"),
						},
						"Reset counts",
					),
					"",
				),
			),
			render(field("inspector")),
		),
		div(
			{ class: "trail-panel trail-agents" },
			header({ class: "trail-title" }, span("Agents")),
			p({ class: "trail-hint trail-status" }, field("inferenceText")),
			div(
				{ class: "trail-add" },
				select(
					{
						class: "trail-profile",
						"aria-label": "Profile",
						title: "What the agent is placed as",
						"on:change": send("setProfile", targetValue()),
					},
					each(
						field("profileOptions"),
						option({ value: field("id"), selected: field("selected") }, field("text")),
					),
				),
				button(
					{
						class: "trail-button trail-add-agent",
						type: "button",
						disabled: field("cannotAdd"),
						"on:click": send("addAgent"),
					},
					field("addText"),
				),
			),
			$if(
				field("hasAgents"),
				div(
					{ class: "trail-agent" },
					// One line: a tab per agent, the pencil that changes the current one's name (the
					// name to type, with a button that takes it and one that leaves it, once pressed),
					// what the agent is and the button that takes it off the tree.
					div(
						{ class: "trail-agent-head" },
						div(
							{ class: "trail-tabs", role: "tablist" },
							each(
								field("tabs"),
								button(
									{
										class: "trail-tab",
										type: "button",
										role: "tab",
										"aria-selected": field("pressed"),
										"on:click": send("showAgent", sourceKey()),
									},
									field("text"),
								),
							),
						),
						$if(
							field("renaming"),
							form(
								{ class: "trail-rename flex items-center gap-1", "on:submit": send("renameAgent") },
								input({
									class: "trail-name input input-sm w-48 font-bold",
									"aria-label": "The agent's name",
									value: field("nameDraft"),
									"on:input": send("draftName", targetValue()),
								}),
								button(
									{
										class: "trail-name-accept btn btn-primary btn-xs btn-square",
										type: "submit",
										title: "Take this name",
										"aria-label": "Take this name",
									},
									"✓",
								),
								button(
									{
										class: "trail-name-cancel btn btn-ghost btn-xs btn-square",
										type: "button",
										title: "Keep the name it had",
										"aria-label": "Keep the name it had",
										"on:click": send("cancelName"),
									},
									"✕",
								),
							),
							button(
								{
									class: "trail-name-edit btn btn-ghost btn-xs btn-square",
									type: "button",
									title: "Rename the agent",
									"aria-label": "Rename the agent",
									"on:click": send("editName"),
								},
								"✎",
							),
						),
						span({ class: "trail-about" }, field("currentAbout")),
						button(
							{
								class: "trail-button trail-close-agent",
								type: "button",
								title: "Take this agent off the tree",
								"on:click": send("closeAgent"),
							},
							"Close",
						),
					),
					$if(field("hasNameProblem"), p({ class: "trail-problem" }, field("nameProblem")), ""),
					render(seqItem("agents", "current")),
				),
				"",
			),
		),
	),
	on: {
		// rows and nodes: what rowsOf and nodesOf made of the app's root.
		show(next, [rows, nodes], ctx) {
			const C = ctx.scope.components;
			next.nodes = nodes;
			next.tree.rows = rows.map((row) => C.TourStep(row));
			settle(next, this.log, nodes);
		},
		// entries: what an event (trace.js's entriesOf), or a message an agent sent, left; numbered
		// here.
		record(next, [entries], ctx) {
			ctx.stopNext();
			const numbered = entries.map((entry, i) => ({ ...entry, n: this.seen + i + 1 }));
			const log = [...this.log, ...numbered].slice(-MAX_ENTRIES);
			next.seen = this.seen + entries.length;
			next.log = log;
			settle(next, log, this.nodes);
		},
		reset(next) {
			next.log = [];
			settle(next, [], this.nodes);
		},
		// From a row: the inspector shows its place.
		pick(next, [key], ctx) {
			ctx.stopNext();
			next.inspector.at = key;
			next.inspector.open = -1;
			settle(next, this.log, this.nodes);
		},
		// Asks the host which models it has and what agents can be placed as.
		checkInference: {
			args: [],
			emits: { ask: ["models", "agentProfiles"] },
			run(_next, _args, ctx) {
				ctx.ask("models");
				ctx.ask("agentProfiles");
			},
		},
		setProfile: {
			args: [t.string()],
			run(next, [id]) {
				next.profile = id;
			},
		},
		// The model an agent picked: the one the next agents start with.
		useModel: {
			args: [t.string()],
			run(next, [model]) {
				next.model = model.startsWith("echo/") ? "" : model;
			},
		},
		// An agent at the inspector's place, once the host gave it a name.
		addAgent: {
			args: [],
			emits: { ask: ["agentName"] },
			run(next, _args, ctx) {
				if (this.cannotAdd) return;
				next.placing = this.inspector.at;
				const taken = this.agents.map(({ target }) => ({ name: target.name, icon: target.icon }));
				ctx.ask("agentName", [taken]);
			},
		},
		showAgent: {
			args: [t.int({ min: 0 })],
			run(next, [index]) {
				if (index < this.agents.length) next.current = index;
				next.renaming = false;
				next.nameProblem = "";
			},
		},
		// The pencil: the current agent's name becomes one to type over.
		editName(next) {
			next.renaming = true;
			next.nameDraft = this.currentName;
			next.nameProblem = "";
		},
		draftName: {
			args: [t.string()],
			run(next, [text]) {
				next.nameDraft = text;
			},
		},
		// Leaves the name as it was.
		cancelName(next) {
			next.renaming = false;
			next.nameProblem = "";
		},
		// The name typed for the current agent: taken unless it's empty or another agent's, which
		// leaves it there to type over.
		renameAgent: {
			args: [],
			run(next) {
				const name = this.nameDraft.trim();
				const others = this.agents.filter((_, i) => i !== this.current);
				if (name === "") next.nameProblem = "A name can't be empty.";
				else if (others.some(({ target }) => target.name === name)) {
					next.nameProblem = `Another agent is called ${name}.`;
				} else {
					next.nameProblem = "";
					next.renaming = false;
					next.agents[this.current].target.name = name;
					settle(next, this.log, this.nodes);
				}
			},
		},
		// Takes the current agent off the tree; what it was waiting for finds nobody.
		closeAgent(next) {
			next.agents.splice(this.current, 1);
			next.current = Math.max(0, Math.min(this.current, this.agents.length - 2));
			next.renaming = false;
			next.nameProblem = "";
			settle(next, this.log, this.nodes);
		},
		// From an agent's probe: text, from the agent called from, for the one called to. Left in
		// its probe's inbox, which its agent reads now, or once it's done when it's busy; nothing
		// waits for what it does about it. One for an agent no longer there is dropped.
		told: {
			args: [t.string(), t.string(), t.string()],
			run(next, [to, from, text], ctx) {
				ctx.stopNext();
				const index = this.agents.findIndex(({ target }) => target.name === to);
				if (index === -1) return;
				next.agents[index].target.inbox.push({ from, text });
				ctx.sendAt("checkMail", [], ["agents", index], { detached: true });
			},
		},
		// From an agent's probe, which moved: the rows say where it is.
		moved(next, _args, ctx) {
			ctx.stopNext();
			settle(next, this.log, this.nodes);
		},
	},
	answers: {
		// [{ provider, id, name }]: the models the host has keys for; none without a server.
		models: {
			ok(next, [models]) {
				next.models = (Array.isArray(models) ? models : [])
					.filter((m) => typeof m?.provider === "string" && typeof m.id === "string")
					.map((m) => ({ id: `${m.provider}/${m.id}`, name: String(m.name ?? m.id) }));
				next.inference = next.models.length > 0 ? "ready" : "none";
				if (this.model === "" && next.models.length > 0) next.model = next.models[0].id;
			},
			error(next) {
				next.inference = "none";
			},
			unhandled(next) {
				next.inference = "none";
			},
		},
		agentProfiles: {
			ok(next, [profiles]) {
				next.profiles = Array.isArray(profiles) ? profiles : [];
				if (!next.profiles.some((profile) => profile.id === this.profile)) {
					next.profile = next.profiles[0]?.id ?? "";
				}
			},
		},
		agentName: {
			ok: {
				run(next, [found], ctx) {
					place(this, next, ctx, found);
				},
			},
			unhandled: {
				run(next, _args, ctx) {
					place(this, next, ctx, { name: `Agent ${this.agents.length + 1}`, icon: "🤖" });
				},
			},
		},
	},
});

export const trailComponents = {
	...tourComponents,
	...agentComponents,
	...transcriptComponents,
	Probe,
	Trail,
};

// A trail with nothing in it yet.
export const trail = (C) => C.Trail({ tree: C.TourTree(), inspector: C.Probe() });
