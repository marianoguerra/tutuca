// The workshop's app: a Shelf of components of any kind, which defines new ones in its own
// scope from a pure-tutuca module's source (the defineComponent ask, src/pure/define.js), checks
// one without defining it (checkComponent), and adds an instance of any component its scope can
// make, by name. Defining a name that's there again gives it a new definition, and the instances
// on the shelf move onto it with their state.
import { checkReportText, defineReportText } from "../../src/pure/index.js";
import {
	$if,
	component,
	each,
	field,
	renderIt,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";

const { button, div, form, h2, input, li, p, pre, span, textarea, ul } = tag;

// A component written in JavaScript, there from the start: a name to give a new definition too.
const Note = component({
	name: "Note",
	fields: { text: t.string({ default: "A note" }) },
	view: p({ class: "italic opacity-80" }, field("text")),
});

// What the source box starts with: a component module to define as it is.
export const STARTER = `import { button, div, field, send, span } from "tutuca/view";

export type Counter = { label: string; count: number };

export const Counter = {
	defaults: { label: "Clicks", count: 0 },
	on: {
		inc: {
			run(next) {
				next.count += 1;
			},
		},
	},
	view: div(
		{ class: "flex items-center gap-3" },
		span({ class: "text-sm opacity-70" }, field("label")),
		button({ class: "btn btn-sm btn-primary", "on:click": send("inc") }, field("count")),
	),
};
`;

const Shelf = component({
	name: "Shelf",
	fields: {
		items: t.array(t.component()),
		source: t.string(), // The module in the source box.
		addName: t.string(), // The name typed to add one by.
		report: t.string(), // What the last check, define or add said.
		defined: t.array(t.string()), // The names defined here so far, in order.
	},
	queries: {
		get hasItems() {
			return this.items.length > 0;
		},
		get hasReport() {
			return this.report !== "";
		},
		get definedText() {
			return this.defined.length === 0 ? "none yet" : this.defined.join(", ");
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		h2({ class: "text-xs font-bold uppercase opacity-60" }, "Shelf"),
		$if(
			field("hasItems"),
			ul(
				{ class: "flex flex-col gap-2" },
				each(
					field("items"),
					li(
						{ class: "flex items-center gap-3 rounded-box border border-base-300 p-3" },
						div({ class: "flex-1" }, renderIt()),
						button(
							{
								class: "btn btn-xs btn-ghost",
								title: "Take it off the shelf",
								"on:click": send("remove", sourceKey()),
							},
							"✕",
						),
					),
				),
			),
			p({ class: "text-sm opacity-60" }, "Nothing on the shelf."),
		),
		form(
			{ class: "flex flex-col gap-2", "on:submit+prevent": send("defineSource") },
			textarea({
				class: "textarea textarea-bordered font-mono text-xs h-64 w-full",
				"aria-label": "Component source",
				spellcheck: "false",
				value: field("source"),
				"on:input": send("setSource", targetValue()),
			}),
			div(
				{ class: "flex flex-wrap items-center gap-2" },
				button({ class: "btn btn-sm", type: "button", "on:click": send("checkSource") }, "Check"),
				button({ class: "btn btn-sm btn-primary", type: "submit" }, "Define"),
				span({ class: "text-sm opacity-70" }, "Defined here: ", field("definedText")),
			),
		),
		form(
			{ class: "flex items-center gap-2", "on:submit+prevent": send("addNamed") },
			input({
				class: "input input-sm input-bordered w-48",
				"aria-label": "Component name",
				placeholder: "Component name",
				value: field("addName"),
				"on:input": send("setAddName", targetValue()),
			}),
			button({ class: "btn btn-sm", type: "submit" }, "Add"),
		),
		$if(
			field("hasReport"),
			pre(
				{ class: "shelf-report whitespace-pre-wrap rounded-box bg-base-200 p-3 font-mono text-xs" },
				field("report"),
			),
			"",
		),
	),
	on: {
		setSource: {
			pure: true,
			args: [t.string()],
			run(next, [text]) {
				next.source = text;
			},
		},
		setAddName: {
			pure: true,
			args: [t.string()],
			run(next, [text]) {
				next.addName = text;
			},
		},
		// Checks source where the shelf is, defining nothing: the report says what's wrong.
		check: {
			args: [t.string({ minLength: 1 })],
			emits: { ask: ["checkComponent"] },
			run(next, [source], ctx) {
				next.source = source;
				next.report = "Checking…";
				ctx.ask("checkComponent", [source]);
			},
		},
		// Defines what source says in the shelf's scope, once it checks; a name that's there
		// already gets the new definition.
		define: {
			args: [t.string({ minLength: 1 })],
			emits: { ask: ["defineComponent"] },
			run(next, [source], ctx) {
				next.source = source;
				next.report = "Defining…";
				ctx.ask("defineComponent", [source]);
			},
		},
		// The source box's buttons.
		checkSource: {
			args: [],
			emits: { ask: ["checkComponent"] },
			run(next, _args, ctx) {
				if (this.source.trim() === "") return;
				next.report = "Checking…";
				ctx.ask("checkComponent", [this.source]);
			},
		},
		defineSource: {
			args: [],
			emits: { ask: ["defineComponent"] },
			run(next, _args, ctx) {
				if (this.source.trim() === "") return;
				next.report = "Defining…";
				ctx.ask("defineComponent", [this.source]);
			},
		},
		// A new name on the shelf, made with fields (its defaults for what they leave out), by a
		// name its scope can make.
		add: {
			args: [t.string({ minLength: 1 }), t.option(t.any())],
			run(next, [name, fields], ctx) {
				const made = ctx.tryMake(name, fields ?? {});
				if (made.err !== undefined) {
					const names = ctx.componentNames(true).join(", ");
					next.report = `Can't add ${name}: ${made.err.error}. The shelf can make: ${names}.`;
					return;
				}
				next.items.push(made.ok);
				next.report = `Added ${name}, now at .items[${this.items.length}].`;
			},
		},
		addNamed(next, _args, ctx) {
			const name = this.addName.trim();
			if (name === "") return;
			const made = ctx.tryMake(name, {});
			if (made.err !== undefined) {
				next.report = `Can't add ${name}: ${made.err.error}.`;
				return;
			}
			next.items.push(made.ok);
			next.report = `Added ${name}, now at .items[${this.items.length}].`;
		},
		remove: {
			args: [t.int({ min: 0 })],
			run(next, [i]) {
				next.items.splice(i, 1);
			},
		},
	},
	answers: {
		checkComponent: {
			ok(next, [report]) {
				next.report = checkReportText(report);
			},
			error(next, [error]) {
				next.report = `It wasn't checked: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.report = "It wasn't checked: this page can't check components.";
			},
		},
		defineComponent: {
			ok(next, [answer]) {
				next.report = defineReportText(answer);
				if (!answer.ok) return;
				for (const name of answer.registered) {
					if (!next.defined.includes(name)) next.defined.push(name);
				}
			},
			error(next, [error]) {
				next.report = `It wasn't defined: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.report = "It wasn't defined: this page can't define components.";
			},
		},
	},
});

export const shelfComponents = { Note, Shelf };
export const shelf = (C) =>
	C.Shelf({
		items: [C.Note({ text: "Define a component, then add it here by its name." })],
		source: STARTER,
	});
