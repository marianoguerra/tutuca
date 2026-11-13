// 2. A todo list: arrays of records, loops, form inputs and computed values.
// Methods are getters the view reads like fields; each() repeats a view per item.
// Its renders are what it is elsewhere: tui in a terminal (`node scripts/tui.js todo-list`), js
// the code that makes it, md a description of it, ps a printed checklist (as PostScript and PDF),
// docx a Word document of it, llmContext what a model is told about it and
// llmTools what a model can do to it (the Renders demo shows them).
import {
	$if,
	component,
	each,
	enableTargets,
	field,
	lookupBind,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "tutuca";
import { docx, docxTarget } from "tutuca/docx/target";
import { js, jsTarget } from "tutuca/jsast/target";
import {
	Case,
	Choose,
	llmContext,
	llmContextTarget,
	llmTools,
	llmToolsTarget,
	toolArg,
	When,
} from "tutuca/llm/target";
import { md, mdTarget } from "tutuca/mdast/target";
import { ps, psTarget } from "tutuca/ps/target";
import { book, step } from "tutuca/storybook";
import { tuiTarget } from "tutuca/tui/target";

// What it renders besides views is opt in, a target at a time.
enableTargets(
	tuiTarget,
	jsTarget,
	mdTarget,
	psTarget,
	docxTarget,
	llmContextTarget,
	llmToolsTarget,
);

const { box, button, div, form, input, label, li, p, span, text, ul } = tag;
const { ArrayExpression, CallExpression, Identifier, Literal, MemberExpression } = js;
const { ObjectExpression, Property } = js;
const { arguments: args, callee, elements, key, object, properties, property, value } = js;
const { Heading, List, ListItem, Paragraph, Root } = md;
const { Fact, Hint, Item, Items, Section } = llmContext;
const { Enum, Option, Str, Tool, Tools } = llmTools;

// C.Name({ field: value, ... }): the code that makes a component in a state, with a scope's
// components, as a story's make does.
const make = (name, ...props) =>
	CallExpression(
		callee(MemberExpression(object(Identifier({ name: "C" })), property(Identifier({ name })))),
		args(ObjectExpression(properties(...props))),
	);
const prop = (name, node) => Property({ kind: "init" }, key(Identifier({ name })), value(node));
// A field that's a string, a boolean or a number that can't be negative.
const literal = (name) => prop(name, Literal({ value: field(name) }));

// Which task a tool is about: its index, each said with its title, so the model picks by what
// the user calls it and can only pick one that's there.
const whichTask = Enum(
	"index",
	"Which task.",
	each(field("items"), Option(lookupBind("key"), field("title"), When(field("done"), " (done)"))),
);

export const TodoList = component({
	name: "TodoList",
	fields: {
		text: t.string(),
		items: t.array(t.record({ title: t.string(), done: t.boolean() })),
	},
	queries: {
		get left() {
			return this.items.filter((item) => !item.done).length;
		},
		get isEmpty() {
			return this.items.length === 0;
		},
		// The printed checklist's page: a row per item (one for "Nothing to do."), 22 points apart.
		get pageHeight() {
			return 130 + Math.max(1, this.items.length) * 22;
		},
		get leftY() {
			return -(104 + Math.max(1, this.items.length) * 22);
		},
	},
	view: div(
		{ class: "flex max-w-sm flex-col gap-3" },
		form(
			{ class: "join", "on:submit": send("add") },
			// targetValue() is the input's value, sent with each keystroke.
			input({
				class: "input join-item",
				placeholder: "What needs doing?",
				value: field("text"),
				"on:input": send("setText", targetValue()),
			}),
			button({ class: "btn btn-primary join-item" }, "Add"),
		),
		$if(
			field("isEmpty"),
			p({ class: "opacity-60" }, "Nothing to do."),
			ul(
				{ class: "flex flex-col gap-1" },
				// Inside the loop, field() reads the item; sourceKey() is its index.
				each(
					field("items"),
					li(
						{ class: "flex items-center gap-2" },
						label(
							{ class: "flex flex-1 items-center gap-2" },
							input({
								type: "checkbox",
								class: "checkbox checkbox-sm",
								checked: field("done"),
								"on:change": send("toggle", sourceKey()),
							}),
							span({}, field("title")),
						),
						button({ class: "btn btn-xs btn-ghost", "on:click": send("remove", sourceKey()) }, "✕"),
					),
				),
			),
		),
		p({ class: "text-sm opacity-60" }, field("left"), " left"),
	),
	// The same list in a terminal. Enter in the input submits it, as in a form; the [ ] and ✕
	// boxes take focus with Tab and a click, and Enter or space presses them.
	renders: {
		tui: box(
			{ borderStyle: "round", borderText: "Todo", paddingX: "1", gap: "1", width: "48" },
			box(
				{ flexDirection: "row", gap: "1", "on:submit": send("add") },
				input({
					flexGrow: "1",
					placeholder: "What needs doing?",
					value: field("text"),
					"on:input": send("setText", targetValue()),
				}),
				box({ focusable: "true", bold: "true", color: "green", "on:click": send("add") }, "[Add]"),
			),
			$if(
				field("isEmpty"),
				text({ dim: "true" }, "Nothing to do."),
				// A scroll container: past six items it scrolls, by wheel, PageUp and PageDown, and to
				// what Tab focuses.
				box(
					{ maxHeight: "6", overflowY: "auto", paddingRight: "1" },
					each(
						field("items"),
						box(
							{ flexDirection: "row", gap: "1" },
							box(
								{ focusable: "true", "on:click": send("toggle", sourceKey()) },
								$if(field("done"), "[x]", "[ ]"),
							),
							text(
								{ flexGrow: "1", dim: field("done"), strikethrough: field("done") },
								field("title"),
							),
							box(
								{ focusable: "true", color: "red", "on:click": send("remove", sourceKey()) },
								"✕",
							),
						),
					),
				),
			),
			text({ dim: "true" }, field("left"), " left"),
		),
		// C.TodoList({ text: "", items: [{ title: "Buy milk", done: false }, ...] }): an item is a
		// record, an object in its array.
		js: make(
			"TodoList",
			literal("text"),
			prop(
				"items",
				ArrayExpression(
					elements(
						each(field("items"), ObjectExpression(properties(literal("title"), literal("done")))),
					),
				),
			),
		),
		// ## Todo, a task list item per item, and how many are left.
		md: Root(
			Heading({ depth: 2 }, "Todo"),
			$if(
				field("isEmpty"),
				Paragraph("Nothing to do."),
				List(each(field("items"), ListItem({ checked: field("done") }, Paragraph(field("title"))))),
			),
			Paragraph(field("left"), " left"),
		),
		// A checklist to print: a box per item, ticked when it's done, from the page's top.
		ps: ps.Page(
			{ width: 320, height: field("pageHeight") },
			ps.Group(
				{ x: 36, y: field("pageHeight") },
				ps.Text({ x: 0, y: -52, size: 20, font: "Helvetica-Bold" }, "Todo"),
				$if(
					field("isEmpty"),
					ps.Text({ x: 0, y: -84, fill: "#666666" }, "Nothing to do."),
					ps.Group(
						{ y: -84, stepY: -22 },
						each(
							field("items"),
							ps.Group(
								ps.Rect({ x: 0, y: -2, width: 12, height: 12, stroke: "#333333" }),
								$if(
									field("done"),
									ps.Path(
										{ stroke: "#22aa77", lineWidth: 2, lineCap: "round", lineJoin: "round" },
										ps.MoveTo({ x: 2, y: 4 }),
										ps.LineTo({ x: 5, y: 1 }),
										ps.LineTo({ x: 10, y: 9 }),
									),
									null,
								),
								ps.Text(
									{ x: 20, y: 0, fill: $if(field("done"), "#888888", "#000000") },
									field("title"),
								),
							),
						),
					),
				),
				ps.Text({ x: 0, y: field("leftY"), size: 10, fill: "#666666" }, field("left"), " left"),
			),
		),
		// A heading, a task per item, and how many are left.
		docx: docx.Section(
			docx.Heading({ level: 1 }, "Todo"),
			$if(
				field("isEmpty"),
				docx.Paragraph("Nothing to do."),
				docx.List(each(field("items"), docx.ListItem({ checked: field("done") }, field("title")))),
			),
			docx.Paragraph(docx.Emphasis(field("left"), " left")),
		),
		// What a model is told: how many are left, the tasks (the first 20) and, by the state,
		// what's being typed and what would help next.
		llmContext: Section(
			"Todo list",
			Fact("Left", field("left")),
			When(field("text"), Fact("Being typed", field("text"))),
			Items(
				{ max: 20, empty: "There are no tasks." },
				each(field("items"), Item({ done: field("done") }, field("title"))),
			),
			Choose(
				Case(field("isEmpty"), Hint("Offer to add the first tasks.")),
				Case({ test: field("left"), is: 0 }, Hint("Everything is done.")),
			),
			When(field("text"), Hint("The user is typing a task: it isn't on the list yet.")),
		),
		// What a model can do: add always; toggle and remove only when there are tasks, and only
		// to the ones there are.
		llmTools: Tools(
			Tool(
				"add_task",
				send("add", toolArg("title")),
				"Add a task to the list.",
				Str({ name: "title", minLength: 1 }, "What needs doing."),
			),
			When(
				field("items"),
				Tool(
					"toggle_task",
					send("toggle", toolArg("index")),
					"Mark a task done, or not done.",
					whichTask,
				),
				Tool(
					"remove_task",
					send("remove", toolArg("index")),
					"Remove a task from the list.",
					whichTask,
				),
			),
		),
	},
	on: {
		setText(next, [text]) {
			next.text = text;
		},
		// The form adds what's typed; a tool call, the title it says, leaving what's typed.
		add(next, [title], ctx) {
			ctx.event?.preventDefault();
			const typed = title === undefined;
			const text = (typed ? this.text : title).trim();
			if (text === "") return;
			next.items.push({ title: text, done: false });
			if (typed) next.text = "";
		},
		toggle(next, [i]) {
			next.items[i].done = !this.items[i].done;
		},
		remove(next, [i]) {
			next.items.splice(i, 1);
		},
	},
});

export default book({
	title: "Todo list",
	components: { TodoList },
	stories: {
		Empty: {
			make: (C) => C.TodoList(),
			sequences: {
				"add two, finish one": [
					step.event("input", "input", { value: "Buy milk" }),
					step.event("submit", "form"),
					step.event("input", "input", { value: "Write docs" }),
					step.event("submit", "form"),
					step.event("change", '[type="checkbox"]'),
					step.check("one left", (s) => s.left === 1 && s.items.length === 2),
				],
			},
		},
		"A few items": {
			make: (C) =>
				C.TodoList({
					items: [
						{ title: "Read the guide", done: true },
						{ title: "Edit this example", done: false },
					],
				}),
		},
	},
});
