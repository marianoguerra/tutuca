// The site's todo list as a pure-tutuca module: its state type, and a namespace of the same
// name that says the rest. The same text loads in tutuca (componentModule) and compiles to
// wasm in tutuca-wax.
import {
	button,
	div,
	each,
	field,
	input,
	label,
	li,
	p,
	send,
	sourceKey,
	span,
	targetValue,
	ul,
	when,
} from "tutuca/view";

export type Item = { title: string; done: boolean };

export type PureTodoList = {
	text: string;
	items: Item[];
	readonly left: number;
	readonly isEmpty: boolean;
	readonly leftText: string;
};

function open(items: Readonly<Item[]>): number {
	let n = 0;
	for (const item of items) {
		if (!item.done) n += 1;
	}
	return n;
}

export const PureTodoList = {
	defaults: { text: "", items: [] },
	queries: {
		get left(): number {
			return open(this.items);
		},
		get isEmpty(): boolean {
			return this.items.length === 0;
		},
		get leftText(): string {
			return `${open(this.items)} left`;
		},
	},
	on: {
		setText: {
			pure: true,
			run(next, [text]: [string]) {
				next.text = text;
			},
		},
		add: {
			run(next, [], ctx) {
				const text = this.text.trim();
				if (text === "") return;
				next.items.push({ title: text, done: false });
				next.text = "";
			},
		},
		toggle: {
			run(next, [i]: [number]) {
				const item = next.items[i];
				if (item === undefined) return;
				item.done = !item.done;
			},
		},
		remove: {
			run(next, [i]: [number]) {
				next.items.splice(i, 1);
			},
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
		when(
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
};
