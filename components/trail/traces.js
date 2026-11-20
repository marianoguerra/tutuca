// The traces view: the trail's log by what caused what (spans.js), under the tour. A list of
// traces, one per event, and the picked one as a waterfall: a row per span, indented under the
// span that sent it, with a bar from when it started to when everything it caused was done,
// the part its own transaction took drawn solid. A row carries its place (data-step), so
// pointing at it points at the tree's row and at the app, as the tree's rows do.
import { CLASSES_META } from "../../src/meta/index.js";
import { $if, component, each, field, send, sourceKey, t, tag } from "../../src/tutuca.js";
import { EVENT_SPAN, spanDetail, tracesOf } from "./spans.js";

const { button, code, div, li, ol, p, pre, span } = tag;

const percent = (n, of) => `${((100 * n) / of).toFixed(2)}%`;
const spansText = (n) => `${n} ${n === 1 ? "span" : "spans"}`;

// A span's colour: its status when that says something went wrong, else its mode's. Each is
// the bar of its own transaction, the bar until all it caused was done and what it says.
const TONES = {
	ok: { self: "bg-success", extent: "bg-success/30", text: "text-success" },
	event: { self: "bg-primary", extent: "bg-primary/30", text: "text-primary" },
	path: { self: "bg-warning", extent: "bg-warning/30", text: "text-warning" },
	notify: { self: "bg-secondary", extent: "bg-secondary/30", text: "text-secondary" },
	unset: { self: "bg-warning", extent: "bg-warning/30", text: "text-warning" },
	error: { self: "bg-error", extent: "bg-error/30", text: "text-error" },
};
const toneOf = ({ mode, status }) => TONES[status === "ok" ? mode : status] ?? TONES.ok;
// A trace's status, as the dot before what it says of itself.
const DOTS = {
	ok: "status status-success",
	unset: "status status-warning",
	error: "status status-error",
};
// tr-trace, tr-span, tr-now and tr-detail style nothing: they say what a node is.
const TRACE =
	"tr-trace flex flex-col w-full px-2 py-1 border border-base-300 rounded-md text-left cursor-pointer";
const TRACE_SHOWN = "bg-primary/10";
const SPAN =
	"tr-span grid grid-cols-[minmax(0,5fr)_minmax(4rem,4fr)_minmax(0,2fr)] gap-2 items-center px-1.5 py-0.5 rounded text-left cursor-pointer";
const SPAN_NOW = "tr-now bg-primary/15";
const SPAN_OPEN = "bg-base-content/10";
const SPAN_REST = "hover:bg-base-content/10";
const BAR = "absolute inset-y-0 min-w-0.5 rounded-sm";
const NOTE = "text-xs";
const toneClasses = Object.values(TONES).flatMap((tone) => Object.values(tone));

const Traces = component({
	name: "Traces",
	meta: {
		[CLASSES_META]: {
			classes: [
				TRACE,
				TRACE_SHOWN,
				SPAN,
				SPAN_NOW,
				SPAN_OPEN,
				SPAN_REST,
				BAR,
				NOTE,
				...toneClasses,
				...Object.values(DOTS),
			].join(" "),
		},
	},
	fields: {
		log: t.any({ default: [] }), // The trail's.
		nodes: t.any({ default: {} }), // The trail's.
		trace: t.number({ default: -1 }), // The trace shown, by its id; -1 for the newest.
		open: t.string(), // The span shown in full, by its id; "" for none.
		nowTrace: t.number({ default: -1 }), // The trace of the event being gone through; -1 for none.
		nowSpan: t.string(), // Its span the step is about.
	},
	queries: {
		get traces() {
			return tracesOf(this.log, this.nodes);
		},
		get current() {
			const { traces } = this;
			return traces.find((trace) => trace.id === this.trace) ?? traces[0] ?? null;
		},
		get hasTraces() {
			return this.traces.length > 0;
		},
		get list() {
			const shown = this.current?.id ?? -1;
			return this.traces.map((trace) => ({
				text: `#${trace.id} ${trace.title}`,
				about: `${spansText(trace.spans.length)} · ${trace.status}`,
				tone: trace.id === shown ? `${TRACE} ${TRACE_SHOWN}` : TRACE,
				dot: DOTS[trace.status],
				pressed: trace.id === shown ? "true" : "false",
			}));
		},
		get rows() {
			const trace = this.current;
			if (trace === null) return [];
			const isNow = trace.id === this.nowTrace;
			return trace.spans.map((s) => {
				const tone = toneOf(s);
				// One background: the step's span, the open one, or the one pointed at.
				const state =
					isNow && s.id === this.nowSpan ? SPAN_NOW : s.id === this.open ? SPAN_OPEN : SPAN_REST;
				return {
					key: s.key,
					rowClass: `${SPAN} ${state}`,
					extentClass: `${BAR} ${tone.extent}`,
					selfClass: `${BAR} ${tone.self}`,
					noteClass: `${NOTE} ${tone.text}`,
					indent: `padding-left: ${s.depth}rem`,
					name: s.name,
					place: s.place,
					comp: s.comp,
					hasComp: s.comp !== "",
					note: s.note,
					hasNote: s.note !== "",
					watch: s.watch === null ? "" : `watch ${s.watch}`,
					hasWatch: s.watch !== null,
					extent: `left: ${percent(s.start, trace.ticks)}; width: ${percent(s.end - s.start, trace.ticks)}`,
					self: `left: ${percent(s.start, trace.ticks)}; width: ${percent(s.selfEnd - s.start, trace.ticks)}`,
					title: `ticks ${s.start} to ${s.end}, its own until ${s.selfEnd}`,
					expanded: s.id === this.open ? "true" : "false",
				};
			});
		},
		get hasDetail() {
			return this.detail !== "";
		},
		get detail() {
			const trace = this.current;
			const found = trace?.spans.find((s) => s.id === this.open);
			return found === undefined ? "" : JSON.stringify(spanDetail(found, trace.id), null, 2);
		},
	},
	view: div(
		{ class: "p-4 pt-3 text-sm" },
		$if(
			field("hasTraces"),
			div(
				{
					class:
						"grid grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)] max-md:grid-cols-1 gap-4 items-start",
				},
				ol(
					{ class: "flex flex-col gap-1 max-h-72 overflow-y-auto" },
					each(
						field("list"),
						li(
							button(
								{
									class: field("tone"),
									type: "button",
									"aria-pressed": field("pressed"),
									"on:click": send("pickTrace", sourceKey()),
								},
								span({ class: "font-mono wrap-anywhere" }, field("text")),
								span(
									{ class: "flex items-center gap-1.5 text-xs text-base-content/65" },
									span({ class: field("dot") }),
									field("about"),
								),
							),
						),
					),
				),
				div(
					{ class: "flex flex-col gap-0.5 min-w-0" },
					each(
						field("rows"),
						button(
							{
								class: field("rowClass"),
								type: "button",
								"data-step": field("key"),
								"aria-expanded": field("expanded"),
								"on:click": send("toggleSpan", sourceKey()),
							},
							span(
								{ class: "flex flex-wrap gap-1.5 items-baseline min-w-0", style: field("indent") },
								span({ class: "font-mono font-bold" }, field("name")),
								span({ class: "font-mono opacity-70" }, field("place")),
								$if(field("hasComp"), span({ class: "font-bold" }, field("comp")), ""),
							),
							span(
								{ class: "relative h-3.5 rounded-sm bg-base-content/5", title: field("title") },
								span({ class: field("extentClass"), style: field("extent") }),
								span({ class: field("selfClass"), style: field("self") }),
							),
							span(
								{ class: "flex gap-1.5 justify-end items-center" },
								$if(
									field("hasWatch"),
									span({ class: "badge badge-outline badge-xs" }, field("watch")),
									"",
								),
								$if(field("hasNote"), span({ class: field("noteClass") }, field("note")), ""),
							),
						),
					),
					$if(
						field("hasDetail"),
						pre(
							{
								class:
									"tr-detail mt-2 px-2.5 py-1.5 border border-base-300 rounded text-xs overflow-x-auto",
							},
							code(field("detail")),
						),
						"",
					),
				),
			),
			p(
				{ class: "text-sm opacity-65" },
				"No traces yet: click something in the app, and what it leads to is a trace here.",
			),
		),
	),
	on: {
		// log and nodes: the trail's, as they are now.
		show(next, [log, nodes]) {
			next.log = log;
			next.nodes = nodes;
		},
		// A trace in the list, by its place in it.
		pickTrace: {
			args: [t.int({ min: 0 })],
			run(next, [index]) {
				next.trace = this.traces[index]?.id ?? -1;
				next.open = "";
			},
		},
		// A span's row: shows it in full, or closes it.
		toggleSpan: {
			args: [t.int({ min: 0 })],
			run(next, [index]) {
				const id = this.current?.spans[index]?.id ?? "";
				next.open = id === this.open ? "" : id;
			},
		},
		// The step the pager is on: the event's trace, by its click, and the span it's about. A
		// new event's trace is the one shown.
		at(next, [trace, spanId = EVENT_SPAN]) {
			if (trace !== this.nowTrace) {
				next.trace = trace;
				next.open = "";
			}
			next.nowTrace = trace;
			next.nowSpan = spanId;
		},
	},
});

export const tracesComponents = { Traces };

// A traces view with nothing in it yet.
export const traces = (C) => C.Traces();
