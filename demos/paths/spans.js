// The trail's log as traces, the way OpenTelemetry tells what happened: the entries an event
// left (trace.js's entriesOf), which the trail keeps by place, grouped by what caused them. A
// trace is everything one event led to, a span a task (a transaction: one handler run), its id
// the task's seq and its parent the task that sent it (cause). The place a span ran at is its
// resource, the component there its scope.
//
// Time is counted, not measured: a tick per place the event's path was read through, then one
// per task, in the order they ran. A span has two ends: selfEnd, when its own transaction was
// done, and end, when everything it caused was.

// What a span's status is for each outcome a transition has.
const STATUS = {
	handled: "ok",
	passed: "ok",
	asked: "ok",
	unhandled: "unset",
	failed: "error",
	stale: "error",
	orphaned: "error",
	lost: "error",
	dropped: "error",
};
const WORST = ["ok", "unset", "error"];
const worst = (a, b) => (WORST.indexOf(a) >= WORST.indexOf(b) ? a : b);

export const EVENT_SPAN = "event";
export const PATH_SPAN = "path";

const callText = ({ name, args }) =>
	`${name}(${(args ?? []).map((arg) => JSON.stringify(arg)).join(", ")})`;
const placeOf = (nodes, key, fallback) => ({
	key,
	place: nodes[key]?.label ?? fallback,
	comp: nodes[key]?.comp ?? "",
});

// What a task's entry says happened in it, as span events.
const eventsOf = (entry) => {
	const events = [];
	for (const { kind, name, args } of entry.emitted ?? []) {
		events.push({ name: `emitted ${kind} ${name}`, attributes: { "tutuca.args": args ?? [] } });
	}
	for (const unhandled of entry.unhandled ?? []) {
		events.push({ name: "unhandled", attributes: { "tutuca.message": unhandled } });
	}
	if (entry.error != null) {
		events.push({
			name: "exception",
			attributes: {
				"exception.type": entry.error.name ?? "Error",
				"exception.message": entry.error.message ?? String(entry.error),
			},
		});
	}
	return events;
};

const taskSpan = (entry, nodes, start) => {
	const status = STATUS[entry.outcome] ?? "unset";
	const attributes = {
		"tutuca.mode": entry.mode,
		"tutuca.from": entry.from,
		"tutuca.to": entry.to,
		"tutuca.args": entry.args,
		"tutuca.outcome": entry.outcome,
		"tutuca.entry": entry.n ?? null,
	};
	if (entry.watch != null) attributes["tutuca.watch"] = entry.watch;
	return {
		id: String(entry.seq),
		parent: entry.cause === null ? EVENT_SPAN : String(entry.cause),
		name: `${entry.mode} ${entry.name}`,
		mode: entry.mode,
		...placeOf(nodes, entry.key, entry.to),
		status,
		note: entry.outcome,
		watch: entry.watch ?? null,
		start,
		selfEnd: start + 1,
		end: start + 1,
		attributes,
		events: eventsOf(entry),
	};
};

// The trace of entries, the ones of one click, in the order they were recorded; null when the
// entry it starts with is no longer in the log.
const traceOf = (id, entries, nodes) => {
	const event = entries.find((entry) => entry.kind === "event") ?? null;
	const tasks = entries.filter((entry) => entry.seq !== null).sort((a, b) => a.seq - b.seq);
	const first = event ?? tasks[0];
	if (first === undefined) return null;
	// An event's trace starts with the event; a message an agent sent has none.
	if (event === null && first.eventType !== "agent") return null;

	const places = entries.filter((entry) => entry.kind === "event" || entry.kind === "walk");
	const root = {
		id: EVENT_SPAN,
		parent: null,
		name:
			event === null
				? `${first.from} sends ${callText(first)}`
				: `${event.eventType} → ${callText(event)}`,
		mode: "event",
		...placeOf(nodes, first.key, first.to),
		status: "ok",
		note: "",
		watch: null,
		start: 0,
		selfEnd: 0,
		end: 0,
		attributes: {
			"tutuca.event": first.eventType,
			"tutuca.to": first.to,
			"tutuca.args": first.args,
		},
		events: [],
	};
	const spans = [root];
	if (places.length > 0) {
		spans.push({
			id: PATH_SPAN,
			parent: EVENT_SPAN,
			name: "read path",
			mode: "path",
			...placeOf(nodes, event.key, event.to),
			status: "ok",
			note: `${places.length} ${places.length === 1 ? "place" : "places"}`,
			watch: null,
			start: 0,
			selfEnd: places.length,
			end: places.length,
			attributes: { "tutuca.to": event.to },
			// Innermost first, as the markers are read.
			events: places.map((entry) => ({
				name: "read",
				attributes: { "tutuca.place": nodes[entry.key]?.label ?? "" },
			})),
		});
	}
	spans.push(...tasks.map((entry, i) => taskSpan(entry, nodes, places.length + i)));

	// A span whose sender isn't among them (it went nowhere, or was cut) hangs from the event.
	const byId = new Map(spans.map((span) => [span.id, span]));
	for (const span of spans) {
		if (span.parent !== null && !byId.has(span.parent)) span.parent = EVENT_SPAN;
	}
	// The ones a task caused ran after it: from the last back, each end reaches its sender's.
	for (const span of spans.toReversed()) {
		const parent = byId.get(span.parent);
		if (parent !== undefined) parent.end = Math.max(parent.end, span.end);
	}
	// The event is over when everything it led to is.
	root.end = Math.max(root.end, 1);
	root.selfEnd = root.end;

	// In the order a tree is read: each span, then what it caused.
	const ordered = [];
	const place = (span, depth) => {
		ordered.push({ ...span, depth });
		for (const child of spans) if (child.parent === span.id) place(child, depth + 1);
	};
	place(root, 0);
	return {
		id,
		title: root.name,
		status: ordered.reduce((status, span) => worst(status, span.status), "ok"),
		ticks: root.end,
		spans: ordered,
	};
};

// The traces of log (the trail's), the newest first: [{ id, title, status, ticks, spans }],
// id the click's number and a span { id, parent, depth, name, mode, key, place, comp, status,
// note, watch, start, selfEnd, end, attributes, events }, in the order a tree is read. nodes
// is the trail's (trail.js's nodesOf), for what each place is called now.
export const tracesOf = (log, nodes = {}) => {
	const groups = new Map();
	for (const entry of log) {
		if (!groups.has(entry.click)) groups.set(entry.click, []);
		groups.get(entry.click).push(entry);
	}
	const traces = [];
	for (const [id, entries] of groups) {
		const trace = traceOf(id, entries, nodes);
		if (trace !== null) traces.push(trace);
	}
	return traces.reverse();
};

// A span as OpenTelemetry names its parts, times in ticks.
export const spanDetail = (span, traceId) => ({
	trace_id: traceId,
	span_id: span.id,
	parent_span_id: span.parent,
	name: span.name,
	start_tick: span.start,
	self_end_tick: span.selfEnd,
	end_tick: span.end,
	status: { code: span.status.toUpperCase(), message: span.note },
	resource: { "tutuca.place": span.place },
	scope: { name: span.comp },
	attributes: span.attributes,
	events: span.events,
});
