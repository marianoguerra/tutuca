// The site's todo list with its handlers written as pure-js source (tutuca/pure): text that is
// checked against the component, its fields' and queries' types, before it can run, and runs
// unable to reach anything but the draft and ctx.

import { pureHandlers } from "../../src/pure/index.js";
import {
	$if,
	component,
	each,
	enableHandlerSources,
	field,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";

enableHandlerSources(pureHandlers());

const { button, div, input, label, li, p, span, ul } = tag;

export const PureTodoList = component({
	name: "PureTodoList",
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
		get leftText() {
			return `${this.left} left`;
		},
	},
	view: div(
		{ class: "flex max-w-sm flex-col gap-3" },
		div(
			{ class: "join" },
			input({
				class: "input join-item",
				placeholder: "What needs doing?",
				value: field("text"),
				"on:input": send("setText", targetValue()),
			}),
			button({ class: "btn btn-primary join-item", "on:click": send("add") }, "Add"),
		),
		$if(
			field("isEmpty"),
			p({ class: "opacity-60" }, "Nothing to do."),
			ul(
				{ class: "flex flex-col gap-1" },
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
		p({ class: "text-sm opacity-60" }, field("leftText")),
	),
	on: {
		setText: {
			args: [t.string()],
			run: `function (next, [text]) {
				next.text = text;
			}`,
		},
		add: {
			args: [],
			run: `function (next) {
				const text = this.text.trim();
				if (text === "") return;
				next.items.push({ title: text, done: false });
				next.text = "";
			}`,
		},
		toggle: {
			args: [t.number()],
			run: `function (next, [i]) {
				const item = next.items[i];
				if (item === undefined) return;
				item.done = !item.done;
			}`,
		},
		remove: {
			args: [t.number()],
			run: `function (next, [i]) {
				next.items.splice(i, 1);
			}`,
		},
	},
});

export const pureTodoComponents = { PureTodoList };
