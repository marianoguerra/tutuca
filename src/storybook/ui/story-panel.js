// The selected story: its sequences, timeline, targets and a form to send one message.
import {
	$if,
	component,
	each,
	field,
	lookupBind,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../tutuca.js";
import { askStory, BADGES, card, ORIGINS, smallButton, title } from "./common.js";

const { button, div, h3, input, li, ol, option, pre, section, select, span, ul } = tag;

const stepFields = () => ({
	label: t.string(),
	status: t.enum("pending", "ok", "failed", "skipped"),
	isNext: t.boolean(),
});
const entryFields = () => ({
	label: t.string(),
	origin: t.enum("initial", "reload", "step", "user"),
	problemCount: t.number().int().min(0),
	isCurrent: t.boolean(),
});
export const SUMMARY_KEYS = [
	"sequences",
	"sequence",
	"steps",
	"timeline",
	"cursor",
	"problems",
	"error",
	"stateJson",
	"changes",
	"reload",
	"targets",
];
// Keeps the step form's choices among the current targets and their messages.
export const syncForm = (next) => {
	if (next.target >= next.targets.length) next.target = 0;
	const messages = next.targets[next.target]?.messages ?? [];
	next.messages = messages.map((m) => m.name);
	if (!next.messages.includes(next.message)) next.message = next.messages[0] ?? "";
	next.sourceKeys = [...(messages.find((m) => m.name === next.message)?.sourceKeys ?? [])];
	if (!next.sourceKeys.includes(next.sourceKey)) next.sourceKey = next.sourceKeys[0] ?? "";
};

export const StoryPanel = component({
	name: "StoryPanel",
	fields: {
		appKey: t.string(),
		sequences: t.array(t.string()),
		sequence: t.string(),
		steps: t.array(t.record(stepFields())),
		timeline: t.array(t.record(entryFields())),
		cursor: t.number().int().min(0),
		problems: t.array(t.string()),
		error: t.string(),
		stateJson: t.string(),
		changes: t.array(t.string()),
		reload: t.array(t.string()),
		targets: t.array(
			t.record({
				label: t.string(),
				messages: t.array(t.record({ name: t.string(), sourceKeys: t.array(t.string()) })),
			}),
		),
		target: t.number().int().min(0),
		messages: t.array(t.string()),
		message: t.string(),
		sourceKeys: t.array(t.string()),
		sourceKey: t.string(),
		argsJson: t.string("[]"),
		argSeed: t.number(1).int(),
		isPlaying: t.boolean(),
	},
	methods: {
		get hasSourceKeys() {
			return this.sourceKeys.length > 0;
		},
		get hasChanges() {
			return this.changes.length > 0;
		},
		get hasReload() {
			return this.reload.length > 0;
		},
		get hasProblems() {
			return this.problems.length > 0;
		},
		get atEnd() {
			return this.cursor >= this.timeline.length - 1 && !this.steps.some((s) => s.isNext);
		},
	},
	loops: {
		steps: {
			enrich({ value }) {
				return { badge: BADGES[value.status] };
			},
		},
		timeline: {
			enrich({ value }) {
				return { icon: ORIGINS[value.origin] };
			},
		},
	},
	// Two columns when the panel, not the window, is wide: the playground shows it beside code.
	view: div(
		{ class: "@container" },
		div(
			{ class: "grid gap-4 @3xl:grid-cols-2" },
			section(
				{ class: card },
				div(
					{ class: "flex flex-wrap items-center gap-2" },
					select(
						{
							class: "select select-sm select-bordered",
							"aria-label": "Sequence",
							value: field("sequence"),
							"on:change": send("selectSequence", targetValue()),
						},
						option({ value: "" }, "(no sequence)"),
						each(field("sequences"), option({ value: lookupBind("value") }, lookupBind("value"))),
					),
					div(
						{ class: "join" },
						smallButton(
							{ class: "btn btn-sm join-item", title: "Reset", "on:click": send("op", "reset") },
							"⏮",
						),
						smallButton(
							{ class: "btn btn-sm join-item", title: "Back", "on:click": send("op", "back") },
							"◀",
						),
						smallButton(
							{ class: "btn btn-sm join-item", title: "Step", "on:click": send("op", "forward") },
							"▶",
						),
						smallButton(
							{
								class: "btn btn-sm join-item",
								title: "Run to end",
								"on:click": send("op", "toEnd"),
							},
							"⏭",
						),
					),
					smallButton(
						{
							class: $if(field("isPlaying"), "btn btn-sm btn-warning", "btn btn-sm btn-primary"),
							"on:click": send("togglePlay"),
						},
						$if(field("isPlaying"), "Pause", "Play"),
					),
				),
				h3({ class: title }, "Steps"),
				ol(
					{ class: "flex flex-col gap-1 text-sm" },
					each(
						field("steps"),
						li(
							{
								class: $if(
									field("isNext"),
									"flex items-center gap-2 rounded bg-base-200 px-2 py-1 font-semibold",
									"flex items-center gap-2 px-2 py-1",
								),
							},
							span({ class: lookupBind("badge") }, field("status")),
							span({ class: "min-w-0 break-all font-mono text-xs" }, field("label")),
						),
						"steps",
					),
				),
				$if(
					field("hasProblems"),
					ul(
						{ class: "flex flex-col gap-1 rounded bg-error/10 p-2", role: "alert" },
						each(
							field("problems"),
							li(
								{ class: "whitespace-pre-wrap font-mono text-xs text-error" },
								lookupBind("value"),
							),
						),
					),
					"",
				),
				h3({ class: title }, "Send a message"),
				div(
					{ class: "flex flex-wrap items-end gap-2" },
					select(
						{
							class: "select select-sm select-bordered max-w-full",
							"aria-label": "Target component",
							value: field("target"),
							"on:change": send("setTarget", targetValue()),
						},
						each(field("targets"), option({ value: lookupBind("key") }, field("label"))),
					),
					select(
						{
							class: "select select-sm select-bordered",
							"aria-label": "Message",
							value: field("message"),
							"on:change": send("setMessage", targetValue()),
						},
						each(field("messages"), option({ value: lookupBind("value") }, lookupBind("value"))),
					),
					$if(
						field("hasSourceKeys"),
						select(
							{
								class: "select select-sm select-bordered",
								"aria-label": "Source key",
								value: field("sourceKey"),
								"on:change": send("setSourceKey", targetValue()),
							},
							each(
								field("sourceKeys"),
								option({ value: lookupBind("value") }, lookupBind("value")),
							),
						),
						"",
					),
					input({
						class: "input input-sm input-bordered min-w-40 flex-1 font-mono",
						"aria-label": "Arguments as a JSON array",
						value: field("argsJson"),
						"on:input": send("setArgs", targetValue()),
					}),
				),
				div(
					{ class: "flex flex-wrap gap-2" },
					smallButton({ "on:click": send("generateArgs") }, "Generate args"),
					smallButton({ class: "btn btn-sm btn-primary", "on:click": send("sendMessage") }, "Send"),
					smallButton(
						{ class: "btn btn-sm btn-secondary", "on:click": send("randomStep") },
						"Random step",
					),
				),
			),
			div(
				{ class: "flex min-w-0 flex-col gap-4" },
				section(
					{ class: card },
					h3({ class: title }, "Timeline"),
					ol(
						{ class: "flex max-h-64 flex-col gap-1 overflow-auto" },
						each(
							field("timeline"),
							li(
								{},
								button(
									{
										type: "button",
										class: $if(
											field("isCurrent"),
											"btn btn-xs btn-primary w-full justify-start font-normal",
											"btn btn-xs btn-ghost w-full justify-start font-normal",
										),
										"on:click": send("gotoEntry", sourceKey()),
									},
									lookupBind("icon"),
									span({ class: "min-w-0 flex-1 truncate text-left font-mono" }, field("label")),
									$if(
										field("problemCount"),
										span({ class: "badge badge-xs badge-error" }, field("problemCount")),
										"",
									),
								),
							),
							"timeline",
						),
					),
				),
				section(
					{ class: card },
					h3({ class: title }, "Changes"),
					$if(
						field("hasChanges"),
						ul(
							{ class: "space-y-1 font-mono text-xs" },
							each(field("changes"), li({ class: "break-all" }, lookupBind("value"))),
						),
						span({ class: "text-xs opacity-60" }, "No changes since the previous entry"),
					),
				),
				$if(
					field("hasReload"),
					section(
						{ class: card },
						h3({ class: title }, "Hot reload"),
						ul(
							{ class: "space-y-1 font-mono text-xs" },
							each(field("reload"), li({ class: "break-all" }, lookupBind("value"))),
						),
					),
					"",
				),
				section(
					{ class: card },
					h3({ class: title }, "State"),
					pre(
						{ class: "max-h-96 overflow-auto rounded bg-base-200 p-3 text-xs" },
						field("stateJson"),
					),
				),
			),
		),
	),
	on: {
		op: {
			args: [t.enum("reset", "back", "forward", "toEnd")],
			emits: { ask: ["story"] },
			run(_next, [op], ctx) {
				askStory(ctx, this, op);
			},
		},
		gotoEntry: {
			args: [t.index("timeline")],
			emits: { ask: ["story"] },
			run(_next, [i], ctx) {
				askStory(ctx, this, "goto", i);
			},
		},
		selectSequence: {
			args: [t.string()],
			emits: { ask: ["story"] },
			run(_next, [name], ctx) {
				askStory(ctx, this, "load", name);
			},
		},
		setTarget: {
			args: [t.string()],
			run(next, [value]) {
				next.target = Math.max(0, Number.parseInt(value, 10) || 0);
				syncForm(next);
			},
		},
		setMessage: {
			args: [t.string()],
			run(next, [value]) {
				next.message = value;
				syncForm(next);
			},
		},
		setSourceKey: {
			args: [t.string()],
			run(next, [value]) {
				next.sourceKey = value;
			},
		},
		setArgs: {
			args: [t.string()],
			run(next, [value]) {
				next.argsJson = value;
			},
		},
		generateArgs: {
			args: [],
			emits: { ask: ["story"] },
			run(next, _args, ctx) {
				next.argSeed = this.argSeed + 1;
				askStory(ctx, this, "sampleArgs", this.target, this.message, this.argSeed);
			},
		},
		sendMessage: {
			args: [],
			emits: { ask: ["story"] },
			run(_next, _args, ctx) {
				const { target, message, argsJson, sourceKey } = this;
				askStory(ctx, this, "sendTo", target, message, argsJson, sourceKey);
			},
		},
		randomStep: {
			args: [],
			emits: { ask: ["story"] },
			run(next, _args, ctx) {
				next.argSeed = this.argSeed + 1;
				askStory(ctx, this, "randomStep", this.argSeed);
			},
		},
		togglePlay: {
			args: [],
			emits: { ask: ["delay"] },
			run(next, _args, ctx) {
				next.isPlaying = !this.isPlaying;
				if (next.isPlaying) ctx.ask("delay", [400]);
			},
		},
	},
	answers: {
		delay: {
			ok(next, _args, ctx) {
				if (!this.isPlaying) return;
				if (this.atEnd) {
					next.isPlaying = false;
					return;
				}
				askStory(ctx, this, "forward");
				ctx.ask("delay", [400]);
			},
			error(next) {
				next.isPlaying = false;
			},
			unhandled(next) {
				next.isPlaying = false;
			},
		},
		story: {
			ok(next, [result]) {
				next.error = "";
				if (typeof result?.argsJson === "string") next.argsJson = result.argsJson;
				// forward returns false at a failing or missing step: stop playing there.
				if (result === false) next.isPlaying = false;
			},
			error(next, [error]) {
				next.error = String(error?.message ?? error);
				next.problems = [next.error];
				next.isPlaying = false;
			},
			unhandled(next) {
				next.problems = ["no story ask handler is registered"];
			},
		},
	},
});
