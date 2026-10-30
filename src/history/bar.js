// The time travel bar: ⏮ ◀ ▶ ⏭, a slider over the states and what made the current one. It
// holds no timeline, it shows the one it's given and asks "history" to move through it, with
// [target, op, arg], op one of goto, back, forward, toStart and toEnd. mountTimeTravel puts
// one, with a historyEngine, next to a live Host.

import { ORIGINS } from "../storybook/ui/common.js";
import {
	$if,
	button,
	component,
	DispatchPath,
	field,
	HOST,
	Host,
	send,
	Target,
	Task,
	t,
	tag,
	targetValue,
} from "../tutuca.js";
import { historyEngine } from "./index.js";

const { div, input, span } = tag;

const OPS = ["goto", "back", "forward", "toStart", "toEnd"];
const BUTTON = "btn btn-xs btn-ghost font-mono";
const KEYS = { ArrowLeft: "back", ArrowRight: "forward", Home: "toStart", End: "toEnd" };

export const TimeTravel = component({
	name: "TimeTravel",
	fields: {
		target: t.string(), // Passed along with each op: the app the timeline belongs to.
		size: t.number().int().min(0),
		cursor: t.number().int().min(0),
		label: t.string(),
		origin: t.string(),
	},
	methods: {
		// One state is not a history to travel through.
		get isShown() {
			return this.size > 1;
		},
		get last() {
			return Math.max(0, this.size - 1);
		},
		get atStart() {
			return this.cursor === 0;
		},
		get atEnd() {
			return this.cursor >= this.last;
		},
		get position() {
			return `state ${this.cursor + 1} of ${this.size}`;
		},
		get icon() {
			return ORIGINS[this.origin] ?? "";
		},
	},
	view: $if(
		field("isShown"),
		div(
			{
				class: "flex w-full items-center gap-2 text-sm",
				role: "group",
				"aria-label": "Time travel",
				title: "Alt+← and Alt+→ step back and forward",
				"on:keydown": send("key"),
			},
			button(
				{
					class: BUTTON,
					title: "First state",
					disabled: field("atStart"),
					"on:click": send("op", "toStart"),
				},
				"⏮",
			),
			button(
				{
					class: BUTTON,
					title: "Back",
					disabled: field("atStart"),
					"on:click": send("op", "back"),
				},
				"◀",
			),
			button(
				{
					class: BUTTON,
					title: "Forward",
					disabled: field("atEnd"),
					"on:click": send("op", "forward"),
				},
				"▶",
			),
			button(
				{
					class: BUTTON,
					title: "Last state",
					disabled: field("atEnd"),
					"on:click": send("op", "toEnd"),
				},
				"⏭",
			),
			input({
				type: "range",
				class: "range range-xs range-primary w-64 max-w-[40vw] shrink-0",
				"aria-label": "State",
				min: "0",
				max: field("last"),
				value: field("cursor"),
				"on:input": send("goto", targetValue()),
			}),
			span(
				{ class: "min-w-0 flex-1 truncate font-mono text-xs tabular-nums opacity-70" },
				field("position"),
				" · ",
				field("icon"),
				" ",
				field("label"),
			),
		),
		"",
	),
	on: {
		show: {
			args: [t.number().int().min(0), t.number().int().min(0), t.string(), t.string()],
			run(next, [size, cursor, label, origin]) {
				Object.assign(next, { size, cursor, label, origin });
			},
		},
		op: {
			args: [t.enum(...OPS)],
			emits: { ask: ["history"] },
			run(_next, [op], ctx) {
				ctx.ask("history", [this.target, op, null]);
			},
		},
		goto: {
			args: [t.string()],
			emits: { ask: ["history"] },
			run(_next, [value], ctx) {
				const i = Number(value);
				if (Number.isInteger(i)) ctx.ask("history", [this.target, "goto", i]);
			},
		},
		// Alt+← and Alt+→ step, Alt+Home and Alt+End jump to the ends.
		key: {
			args: [],
			emits: { ask: ["history"] },
			run(_next, _args, ctx) {
				const op = ctx.event?.altKey ? KEYS[ctx.event.key] : undefined;
				if (op === undefined) return;
				ctx.event.preventDefault?.();
				ctx.ask("history", [this.target, op, null]);
			},
		},
	},
	answers: {
		history: {
			ok() {},
			error(_next, [error]) {
				console.error("time travel failed", error);
			},
		},
	},
});

// What the bar shows of a Timeline, as the args of its show message.
export const showArgs = ({ size, cursor, current }) => [
	size,
	cursor,
	current?.label ?? "",
	current?.origin ?? "",
];
// Sends name(...args) to host's root component from outside the app.
const sendRoot = (host, name, args) => {
	const task = new Task(name, args, HOST, new Target(new DispatchPath()), null);
	host.prepareTask(task, host.rootComponent);
	host.pushTask(task);
};

// Records host's timeline with a historyEngine of at most max states and shows a TimeTravel
// bar for it in rootNode, on a Host of its own; returns { engine, bar, stop }.
export const mountTimeTravel = ({ document, rootNode, host, max = 1000 }) => {
	const bar = new Host({ document, rootNode });
	bar.scope.register({ TimeTravel });
	// A message, not a new root: travel runs while the bar handles its ask.
	const show = (timeline) => sendRoot(bar, "show", showArgs(timeline));
	const engine = historyEngine({ max, onChange: show });
	bar.scope.registerAskHandlers({
		history: ([_target, op, arg]) => (op === "goto" ? engine.travel(arg) : engine[op]()),
	});
	bar.start(bar.scope.components.TimeTravel());
	host.attachSync(engine);
	return { engine, bar, stop: () => bar.stop() };
};
