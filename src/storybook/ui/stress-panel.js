// Stress tests of the selected story, and loading their counterexample as a sequence.

import {
	$if,
	component,
	each,
	field,
	lookupBind,
	send,
	t,
	tag,
	targetValue,
} from "../../tutuca.js";
import { askStory, card, STRESS_IDLE, smallButton, title } from "./common.js";

const { div, h3, input, label, li, ol, option, pre, section, select, span } = tag;

export const StressPanel = component({
	name: "StressPanel",
	fields: (t) => ({
		appKey: t.string(),
		numRuns: t.number(100).int().min(1).max(100000),
		maxCommands: t.number(20).int().min(1).max(1000),
		seed: t.number(1).int(),
		from: t.enum("story", "generated", "current"),
		events: t.boolean(),
		status: t.enum("idle", "running", "passed", "failed", "cancelled", "unavailable"),
		done: t.number().int().min(0),
		total: t.number().int().min(0),
		error: t.string(),
		commands: t.array(t.string()),
		log: t.array(t.string()),
	}),
	methods: {
		get isRunning() {
			return this.status === "running";
		},
		get isFailed() {
			return this.status === "failed";
		},
		get progressMax() {
			return Math.max(1, this.total);
		},
		get hasLog() {
			return this.log.length > 0;
		},
	},
	view: section(
		{ class: card },
		div(
			{ class: "grid max-w-xl grid-cols-3 gap-3" },
			label(
				{ class: "flex flex-col gap-1 text-xs" },
				"Runs",
				input({
					type: "number",
					class: "input input-sm input-bordered w-full",
					value: field("numRuns"),
					"@on.input": send("setNumber", "numRuns", targetValue()),
				}),
			),
			label(
				{ class: "flex flex-col gap-1 text-xs" },
				"Max steps per run",
				input({
					type: "number",
					class: "input input-sm input-bordered w-full",
					value: field("maxCommands"),
					"@on.input": send("setNumber", "maxCommands", targetValue()),
				}),
			),
			label(
				{ class: "flex flex-col gap-1 text-xs" },
				"Seed",
				input({
					type: "number",
					class: "input input-sm input-bordered w-full",
					value: field("seed"),
					"@on.input": send("setNumber", "seed", targetValue()),
				}),
			),
			label(
				{ class: "col-span-2 flex flex-col gap-1 text-xs" },
				"Start from",
				select(
					{
						class: "select select-sm select-bordered w-full",
						value: field("from"),
						"@on.change": send("setFrom", targetValue()),
					},
					option({ value: "story" }, "story state"),
					option({ value: "generated" }, "generated states"),
					option({ value: "current" }, "current state"),
				),
			),
			label(
				{ class: "flex items-center gap-2 self-end pb-1.5 text-xs" },
				input({
					type: "checkbox",
					class: "checkbox checkbox-sm",
					checked: field("events"),
					"@on.change": send("setEvents", targetValue()),
				}),
				"DOM events",
			),
		),
		div(
			{ class: "flex flex-wrap items-center gap-3" },
			smallButton(
				{ class: "btn btn-sm btn-primary", disabled: field("isRunning"), "@on.click": send("run") },
				"Run stress test",
			),
			$if(field("isRunning"), smallButton({ "@on.click": send("cancel") }, "Cancel"), ""),
			span({ class: "badge" }, field("status")),
			span(
				{ class: "text-xs text-base-content/60" },
				field("done"),
				" / ",
				field("total"),
				" runs",
			),
		),
		tag.progress({
			class: "progress progress-primary w-full",
			value: field("done"),
			max: field("progressMax"),
		}),
		$if(
			field("error"),
			pre(
				{ class: "whitespace-pre-wrap rounded bg-error/10 p-3 text-xs text-error" },
				field("error"),
			),
			"",
		),
		$if(
			field("hasLog"),
			div(
				{ class: "flex flex-col gap-2" },
				h3({ class: title }, "Operations log"),
				div(
					{ class: "max-h-64 overflow-auto rounded bg-base-200 p-2 font-mono text-xs" },
					each(field("log"), div({ class: "whitespace-pre" }, lookupBind("value"))),
				),
			),
			"",
		),
		$if(
			field("isFailed"),
			div(
				{ class: "flex flex-col gap-2" },
				h3({ class: title }, "Shrunk counterexample"),
				ol(
					{ class: "list-decimal pl-6 font-mono text-xs" },
					each(field("commands"), li(lookupBind("value"))),
				),
				smallButton(
					{ class: "btn btn-sm btn-secondary self-start", "@on.click": send("load") },
					"Load into stepper",
				),
			),
			"",
		),
	),
	on: {
		setNumber: {
			args: [t.enum("numRuns", "maxCommands", "seed"), t.string()],
			run(draft, [name, value]) {
				const n = Number.parseInt(value, 10);
				if (!Number.isFinite(n)) return;
				const type = StressPanel.fields[name];
				if (type.isValid(n)) draft[name] = n;
			},
		},
		setFrom: {
			args: [t.enum("story", "generated", "current")],
			run(draft, [from]) {
				draft.from = from;
			},
		},
		setEvents: {
			args: [t.boolean()],
			run(draft, [events]) {
				draft.events = events;
			},
		},
		run: {
			args: [],
			emits: { ask: ["story"] },
			run(draft, _args, ctx) {
				if (this.isRunning) return;
				Object.assign(draft, { ...STRESS_IDLE, status: "running", total: this.numRuns });
				const { numRuns, maxCommands, seed, from, events } = this;
				askStory(ctx, this, "stress", { numRuns, maxCommands, seed, from, events });
			},
		},
		cancel: {
			args: [],
			emits: { ask: ["story"] },
			run(_draft, _args, ctx) {
				askStory(ctx, this, "cancelStress");
			},
		},
		load: {
			args: [],
			emits: { ask: ["story"], notify: ["showSteps"] },
			run(_draft, _args, ctx) {
				askStory(ctx, this, "loadCounterexample");
				ctx.notify("showSteps");
			},
		},
		storyReplyOk(draft, [result]) {
			if (typeof result?.status === "string") applyStress(draft, result);
		},
		storyReplyError(draft, [error]) {
			Object.assign(draft, { ...STRESS_IDLE, status: "unavailable" });
			draft.error = String(error?.message ?? error);
		},
		storyHandlerNotFound(draft) {
			draft.status = "unavailable";
		},
	},
});
export const applyStress = (draft, r) => {
	const { status, done = 0, total = 0, error = "", commands = [], log = [] } = r;
	Object.assign(draft, { status, done, total, error, commands: [...commands], log: [...log] });
};
