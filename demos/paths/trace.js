// An event as steps to go through: the tour holds a click or a change before the host hears
// it and works out, at once, everything that would happen: the walk from the element up
// through the marker comments that makes its path, where the message it sends lands and what
// that sends on, and which components the change copies. The page shows one step at a time
// (main.js); the app has the state from before the event until the step that delivers it.
import { eventSend } from "../../src/core/host/events.js";
import { isComponentMarker } from "../../src/core/view/markers.js";
import { plainOf } from "../../src/tree/record.js";
import { jsonText } from "../../src/tree/text.js";
import { Host, specOf } from "../../src/tutuca.js";
import { chainOf, frameText, markerLabel, pathKey, pathLabel } from "./regions.js";
import { EVENT_SPAN, PATH_SPAN } from "./spans.js";
import { rowsOf } from "./tree.js";

// The events it holds: the ones a viewer makes one at a time.
const HELD = ["click", "change"];

// Where node is under root, as the index of each node on the way among its siblings, and the
// node there: a render of the same state puts the same node at the same place.
const indexPath = (node, root) => {
	const path = [];
	for (let n = node; n !== root; n = n.parentNode) {
		path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
	}
	return path;
};
export const nodeAt = (root, path) => path.reduce((node, i) => node?.childNodes[i], root) ?? null;

// What event would send, as the host works it out (eventSend), with the regions its target is
// in, innermost first, and where its target and the element with the handler are; null when no
// handler takes it.
export const captureOf = (event, host, regions) => {
	let sent = null;
	try {
		sent = eventSend(event, host.rootNode, host.root, host.drag, false);
	} catch {
		return null; // The host reports it, as it does without the tour.
	}
	if (sent === null) return null;
	return {
		...sent,
		type: event.type,
		event,
		chain: chainOf(regions, event.target),
		targetAt: indexPath(event.target, host.rootNode),
		nodeAt: indexPath(sent.node, host.rootNode),
	};
};

// What becomes of capture's message, without the app hearing of it: a host with no page runs it
// on the same root. Returns the transitions, in order, and the root they leave.
export const deliver = ({ name, args, to, event, node }, root, components) => {
	const records = [];
	const shadow = new Host({ publish: (record) => records.push(record) });
	shadow.scope.register(components);
	shadow.start(root);
	shadow.send(name, args, { to, now: true, event, node });
	while (shadow.tasks.length > 0) shadow.handleTasks();
	const transitions = records
		.filter((record) => record.kind === "transition")
		.sort((a, b) => a.seq - b.seq);
	return { transitions, after: shadow.root };
};

const callText = (name, args) => `${name}(${args.map(jsonText).join(", ")})`;
const OUTCOMES = {
	handled: "handled",
	passed: "no handler here: passed on",
	unhandled: "nobody handled it",
	stale: "another component is there now: dropped",
	orphaned: "no component is there now: dropped",
};
const transitionText = ({ mode, cause, name, args, to, outcome }) => {
	const kind = mode === "notify" ? "notify " : cause === null ? "" : "sendAt ";
	const where = to?.path == null ? "" : ` at ${pathLabel(to.path.toNodePath())}`;
	return `${kind}${callText(name, args)}${where}: ${OUTCOMES[outcome] ?? outcome}`;
};
const instancesOf = (rows) => rows.filter((r) => r.instance !== null);

// The steps of capture, an event on a host whose root is before: { steps, before, after }.
// A step is { title, caption, tokens, applied, focus, walked, lights, copied, span }: caption what
// it says, tokens the path read so far ([{ text, kind }]), applied whether the app shows the
// state after the event, focus the path the tree marks, walked how many of the regions
// around the target are outlined, lights the tree rows lit ([{ keys, kind, note }]) and copied
// the keys of the rows whose components are new objects; span is the span of the event's trace
// it's about (spans.js): the event's, the reading of its path or a task's, by its seq.
export const stepsOf = (capture, before, components) => {
	const { name, args, to, node, type, chain } = capture;
	const call = callText(name, args);
	const steps = [];
	const add = (step) =>
		steps.push({
			tokens: [],
			applied: false,
			focus: null,
			walked: 0,
			lights: [],
			copied: [],
			span: EVENT_SPAN,
			...step,
		});

	// 1. The element whose handler takes the event.
	add({
		title: "The event",
		caption: `A ${type} on <${node.localName}>: its handler sends ${call}. Where to?`,
	});

	// 2. Up through the markers: each frame comment is a step of the path, read leaf to root.
	let tokens = [];
	let lit = [];
	let reachesComponent = false;
	chain.forEach((region, i) => {
		const { marker } = region;
		let caption;
		if (isComponentMarker(marker)) {
			reachesComponent = true;
			caption =
				region.parent === null
					? "The root's component comment: the path is complete."
					: `A component comment (${markerLabel(marker)}): the frame above it reaches a component.`;
			if (region.parent === null) tokens = [{ text: "·", kind: "root" }, ...tokens];
		} else {
			const frame = region.path.frames.at(-1);
			const kind = reachesComponent ? "node" : "item";
			tokens = [{ text: frameText(frame), kind }, ...tokens];
			reachesComponent = false;
			caption =
				frame.provider === null
					? `A frame comment: ${frameText(frame)} is a step of the path.`
					: `A frame comment: it reads ${frame.provider.name}, which the component ${frame.provider.up} frame(s) up provides.`;
		}
		lit = [...lit, region.key];
		add({
			title: markerLabel(marker),
			caption,
			tokens,
			walked: i + 1,
			lights: [{ keys: lit, kind: "walk", note: "" }],
			span: PATH_SPAN,
		});
	});

	// 3. The path is an address: the keys to the state, and the component there.
	const targetKey = pathKey(to.path.toNodePath());
	const spec = specOf(to.keyPath.getIn(before))?.name ?? "?";
	const walk = { keys: lit, kind: "walk", note: "" };
	add({
		title: "The address",
		caption: `The path leads to the state at ${to.keyPath}, a ${spec}: ${call} runs there.`,
		tokens,
		walked: chain.length,
		lights: [walk, { keys: [targetKey], kind: "target", note: call }],
		span: PATH_SPAN,
	});

	// 4. The message, and each one it leads to: from here on the app has the new state.
	const { transitions, after } = deliver(capture, before, components);
	let lights = [];
	for (const transition of transitions) {
		if (transition.to?.path != null) {
			const keys = [pathKey(transition.to.path.toNodePath())];
			const kind = transition.mode === "notify" ? "hop" : "target";
			lights = [...lights, { keys, kind, note: `${transition.name} ${transition.outcome}` }];
		}
		add({
			title: `${transition.mode} ${transition.name}`,
			caption: transitionText(transition),
			tokens,
			applied: true,
			focus: to.path,
			lights,
			span: String(transition.seq),
		});
	}

	// 5. What changed: the components from the root to each one a handler changed are new
	// copies, the rest are the objects they were, wherever they are now.
	const were = new Set(instancesOf(rowsOf(before)).map((r) => r.instance));
	const now = instancesOf(rowsOf(after));
	const copied = now.filter((r) => !were.has(r.instance)).map((r) => r.row.key);
	add({
		title: "What changed",
		caption:
			copied.length === 0
				? "Nothing changed: every component is the object it was."
				: `${copied.length} of ${now.length} components are new copies, down the path from the root; the rest are the objects they were.`,
		tokens,
		applied: true,
		focus: to.path,
		lights,
		copied,
	});
	return { steps, before, after, transitions, call: `${type} → ${call}` };
};

const placeText = (address) =>
	address == null ? "" : address.isHost ? "host" : pathLabel(address.path.toNodePath());
// Which count a transition adds to where it went: handled there, a notify passing through, or
// whatever else became of it.
const kindOf = ({ mode, outcome }) => {
	if (outcome === "handled") return "handled";
	if (mode === "notify" && (outcome === "passed" || outcome === "unhandled")) return "passed";
	return "other";
};

// What capture, an event, and the transitions it led to leave at each place they went
// through, for the trail (trail.js): the event where its path ends, a walk at each place
// above it, and each transition where it went. An entry is { click, kind, key, eventType, mode,
// name, args, outcome, from, to, seq, cause, origin, error }, key the place's (pathKey), click
// the event's number and the rest data. A transition's entry also has emitted, what its handler
// sent, unhandled, what of that nobody handles, and watch, the id of the watch it ran in: what
// the traces view (spans.js) makes its span of.
export const entriesOf = (capture, transitions, click) => {
	const { name, args, to, type, chain } = capture;
	const base = { click, eventType: type, outcome: "", seq: null, cause: null, origin: null };
	const event = {
		...base,
		mode: "event",
		name,
		args: plainOf(args),
		from: "page",
		to: pathLabel(to.path.toNodePath()),
		error: null,
	};
	const keys = [...new Set(chain.map((region) => region.key))];
	const entries = keys.map((key, i) => ({ ...event, kind: i === 0 ? "event" : "walk", key }));
	return [...entries, ...transitionEntries(transitions, base)];
};

// The entries of transitions, each where it went; base is what they share.
const transitionEntries = (transitions, base, sender = "host") =>
	transitions
		.filter((transition) => transition.to?.path != null)
		.map((transition) => ({
			...base,
			kind: kindOf(transition),
			key: pathKey(transition.to.path.toNodePath()),
			mode: transition.mode,
			name: transition.name,
			args: plainOf(transition.args),
			outcome: transition.outcome,
			from: transition.from?.isHost ? sender : placeText(transition.from),
			to: placeText(transition.to),
			seq: transition.seq,
			cause: transition.cause,
			origin: transition.origin,
			error: plainOf(transition.error ?? null),
			emitted: plainOf(transition.emitted),
			unhandled: plainOf(transition.unhandled),
			watch: transition.watch,
		}));

// What a message an agent sent left: its transitions' entries, with no event or walk, from
// by, the agent's name.
export const sentEntriesOf = (transitions, click, by) =>
	transitionEntries(
		transitions,
		{ click, eventType: "agent", outcome: "", seq: null, cause: null, origin: null },
		`agent ${by}`,
	);

// Holds the HELD events on host's root node: each one a handler takes goes to onCapture
// instead of the host.
export const holdEvents = ({ host, regions, onCapture }) => {
	const onEvent = (event) => {
		if (host.root === null) return;
		const capture = captureOf(event, host, regions());
		if (capture === null) return;
		event.stopImmediatePropagation();
		// A checkbox has changed by the time it says so: back to what the state says, until the
		// step that delivers the event.
		const { target } = event;
		if (event.type === "change" && target.type === "checkbox") target.checked = !target.checked;
		onCapture(capture);
	};
	for (const type of HELD) host.rootNode.addEventListener(type, onEvent, true);
};
