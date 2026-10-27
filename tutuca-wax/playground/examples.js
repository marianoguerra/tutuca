// The playground's examples: the component modules of ../components/, each a
// .tcd and its .wax, with what they need to show (prebuilt modules from
// ../dist/components/ they compose with) and the root to mount. Fields are
// JSON; { "$make": Type, "fields": {...} } makes a component and
// { "$json": value } the components/json tree of a JSON value.

const CLICKER_TCD = `// Your own component: edit it, compile (Ctrl/Cmd-Enter), and it shows on the right.
package tutuca:mine@0.1.0;

/// A counter that remembers its best.
component clicker {
    field count: s32 where count >= 0;
    field best: s32 where best >= 0;

    invariant best_so_far: best >= count;

    message click() changes count, best ensures next.count == count + 1;
    message reset() changes count ensures next.count == 0;

    view main = div(class: "flex items-center gap-2",
        button(class: "btn btn-sm btn-primary", on_click: send(click), "click"),
        span(class: "tabular-nums", field(count), " (best ", field(best), ")"),
        button(class: "btn btn-sm btn-ghost", on_click: send(reset), "reset"));
}

// Test runs these, and random walks of the messages checking the contracts.
example best_stays for clicker {
    start { count: 0, best: 0 }
    send click(); send click(); send reset(); send click();
    expect count == 1 and best == 2;
}
`;

const CLICKER_WAX = `// What clicker.tcd can't say: what each message does to the state.

fn clicker_on_click(state: &clicker_state, ctx: &context) -> &clicker_state {
    let count = state.count + 1;
    let best = state.best;
    if count >s best {
        best = count;
    }
    {clicker_state| count, best };
}

fn clicker_on_reset(state: &clicker_state, ctx: &context) -> &clicker_state {
    clicker_with_count(state, 0);
}
`;

// A TodoList holding two TodoItems (whichever module registers TodoItem).
const TODOS = {
	items: [
		{ $make: "TodoItem", fields: { id: 0, text: "write a component", done: true } },
		{ $make: "TodoItem", fields: { id: 1, text: "compile it in the browser", done: false } },
	],
	nextId: 2,
};

const BOOKS = [
	{ title: "Dune", year: 1965, read: true },
	{ title: "Emma", year: 1815, read: false },
	{ title: "Ulysses", year: 1922, read: false },
];

export const EXAMPLES = [
	{
		id: "clicker",
		title: "Your own: a clicker",
		description: "A starting point: a component written here, not in ../components/.",
		main: "mine/clicker.tcd",
		impl: "mine/clicker.wax",
		sources: { "mine/clicker.tcd": CLICKER_TCD, "mine/clicker.wax": CLICKER_WAX },
		root: "Clicker",
		fields: { count: 0, best: 0 },
	},
	{
		id: "counter",
		title: "Counter, Label and Board",
		description: "Notifies, asks answered now and later, a swap, sends to children by selector.",
		main: "components/counter/counter.tcd",
		impl: "components/counter/counter.wax",
		root: "Board",
		fields: { counters: [], total: 0 },
		asks: { fetchCount: () => new Promise((resolve) => setTimeout(() => resolve(7), 500)) },
	},
	{
		id: "todo_list",
		title: "TodoList",
		description: "Declares the TodoItem interface; composes with the prebuilt todo_item module.",
		main: "components/todo_list/todo_list.tcd",
		impl: "components/todo_list/todo_list.wax",
		deps: ["todo_item"],
		root: "TodoList",
		fields: TODOS,
	},
	{
		id: "todo_item",
		title: "TodoItem, a checkbox",
		description: "Implements TodoList's interface (used from todo_list.tcd); the prebuilt TodoList holds it.",
		main: "components/todo_item/todo_item.tcd",
		impl: "components/todo_item/todo_item.wax",
		uses: ["components/todo_list/todo_list.tcd"],
		deps: ["todo_list"],
		root: "TodoList",
		fields: TODOS,
	},
	{
		id: "todo_card",
		title: "TodoItem, a card",
		description: "Another implementation of the same interface, registered as TodoItem.",
		main: "components/todo_card/todo_card.tcd",
		impl: "components/todo_card/todo_card.wax",
		uses: ["components/todo_list/todo_list.tcd"],
		deps: ["todo_list"],
		root: "TodoList",
		fields: TODOS,
	},
	{
		id: "showcase",
		title: "Shelf and Note",
		description: "Scopes, loop hooks (key, filter, enrich, prepare, iter), provides, push_view, render_it, drag and drop.",
		main: "components/showcase/showcase.tcd",
		impl: "components/showcase/showcase.wax",
		root: "Shelf",
		fields: {
			books: BOOKS,
			onlyUnread: false,
			tags: ["classic", "novel"],
			current: 1,
			theme: "badge badge-secondary",
			note: { $make: "Note", fields: { text: "pinned" } },
			notes: [
				{ $make: "Note", fields: { text: "drop a book here" } },
				{ $make: "Note", fields: { text: "or here" } },
			],
		},
	},
	{
		id: "json",
		title: "JSON viewer and editor",
		description: "Nine types implementing a json_value interface; the editor pushes its mode's view.",
		main: "components/json/json.tcd",
		impl: "components/json/json.wax",
		root: "JsonEditor",
		fields: {
			value: { $json: { name: "tutuca-wax", version: 3, wasm: true, tags: ["wax", "tcd"], deps: {} } },
			mode: "edit",
			showText: true,
		},
	},
	{
		id: "layout",
		title: "Layouts and holes",
		description: "Hbox, Vbox, Tabs and Grid hold Holes; a hole's + asks what its scope can make and swaps itself for the one picked.",
		main: "components/layout/layout.tcd",
		impl: "components/layout/layout.wax",
		deps: ["counter"],
		root: "Vbox",
		fields: { items: [{ $make: "Hole", fields: {} }] },
	},
];
