// 2. A todo list: arrays of records, loops, form inputs and computed values.
// Methods are getters the view reads like fields; each() repeats a view per item.
import { $if, component, each, field, send, sourceKey, tag, targetValue } from "tutuca";
import { step, stories } from "tutuca/storybook";

const { button, div, form, input, label, li, p, span, ul } = tag;

export const TodoList = component({
	name: "TodoList",
	fields: (t) => ({
		text: t.string(),
		items: t.array(t.record({ title: t.string(), done: t.boolean() })),
	}),
	methods: {
		get left() {
			return this.items.filter((item) => !item.done).length;
		},
		get isEmpty() {
			return this.items.length === 0;
		},
	},
	view: div(
		{ class: "flex max-w-sm flex-col gap-3" },
		form(
			{ class: "join", "@on.submit": send("add") },
			// targetValue() is the input's value, sent with each keystroke.
			input({
				class: "input join-item",
				placeholder: "What needs doing?",
				value: field("text"),
				"@on.input": send("setText", targetValue()),
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
								"@on.change": send("toggle", sourceKey()),
							}),
							span({}, field("title")),
						),
						button(
							{ class: "btn btn-xs btn-ghost", "@on.click": send("remove", sourceKey()) },
							"✕",
						),
					),
				),
			),
		),
		p({ class: "text-sm opacity-60" }, field("left"), " left"),
	),
	on: {
		setText(draft, [text]) {
			draft.text = text;
		},
		add(draft, _args, ctx) {
			ctx.event?.preventDefault();
			const title = this.text.trim();
			if (title === "") return;
			draft.items.push({ title, done: false });
			draft.text = "";
		},
		toggle(draft, [i]) {
			draft.items[i].done = !this.items[i].done;
		},
		remove(draft, [i]) {
			draft.items.splice(i, 1);
		},
	},
});

export default stories({
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
