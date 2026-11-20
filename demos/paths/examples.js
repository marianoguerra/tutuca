// The tour's examples, in the order it shows them: one new kind of path step at a time, then
// small apps that combine them. Each is { id, title, idea, components, make }: idea is the
// one thing it's there to show, make(C) its root.
import { CLASSES_META } from "../../src/meta/classes.js";
import {
	$if,
	component,
	each,
	field,
	lookupBind,
	provided,
	pushView,
	render,
	renderEach,
	renderIt,
	send,
	seqItem,
	sourceKey,
	t,
	tag,
} from "../../src/tutuca.js";

const { button, div, h2, input, label, li, nav, span, strong, table, tbody, td, tr, ul } = tag;

const CARD = "flex flex-col gap-5 rounded-box border border-base-300 bg-base-100 p-5";
const ROW = "flex items-center gap-3";
const TITLE = "text-xs font-bold uppercase opacity-60";
// The classes a component's queries and loops make, which its view doesn't spell out.
const classes = (text) => ({ [CLASSES_META]: { classes: text } });
const DONE_CLASSES = classes("flex-1 line-through opacity-50");
const TAB_CLASSES = classes("tab tab-active");

// --- the pieces the examples share -------------------------------------------------------

// A counter with a label; compact is the same state as a badge with one button.
const Counter = component({
	name: "Counter",
	fields: { label: t.string(), count: t.number() },
	views: {
		main: div(
			{ class: ROW },
			span({ class: "w-16 text-sm opacity-70" }, field("label")),
			button({ class: "btn btn-sm", "on:click": send("dec") }, "−"),
			span({ class: "w-8 text-center text-xl font-bold tabular-nums" }, field("count")),
			button({ class: "btn btn-sm btn-primary", "on:click": send("inc") }, "+"),
		),
		compact: button(
			{ class: "btn btn-sm btn-outline", "on:click": send("inc") },
			field("label"),
			" ",
			span({ class: "badge badge-primary" }, field("count")),
		),
	},
	on: {
		inc(next) {
			next.count += 1;
		},
		dec(next) {
			next.count -= 1;
		},
	},
});

const Tag = component({
	name: "Tag",
	meta: classes("badge badge-primary badge-outline cursor-pointer"),
	fields: { label: t.string(), on: t.boolean() },
	queries: {
		get tagClass() {
			return this.on ? "badge badge-primary cursor-pointer" : "badge badge-outline cursor-pointer";
		},
	},
	view: button({ class: field("tagClass"), "on:click": send("flip") }, field("label")),
	on: {
		flip(next) {
			next.on = !this.on;
		},
	},
});

// A todo: main is a line with its tags, row a table row.
const Todo = component({
	name: "Todo",
	meta: DONE_CLASSES,
	fields: { label: t.string(), done: t.boolean(), tags: t.array(t.component("Tag")) },
	queries: {
		get labelClass() {
			return this.done ? "flex-1 line-through opacity-50" : "flex-1";
		},
	},
	views: {
		main: label(
			{ class: ROW },
			input({
				type: "checkbox",
				class: "checkbox checkbox-sm",
				checked: field("done"),
				"on:change": send("toggle"),
			}),
			span({ class: field("labelClass") }, field("label")),
			renderEach(field("tags")),
		),
		row: tr(
			td(
				input({
					type: "checkbox",
					class: "checkbox checkbox-xs",
					checked: field("done"),
					"on:change": send("toggle"),
				}),
			),
			td({ class: field("labelClass") }, field("label")),
		),
	},
	on: {
		toggle(next) {
			next.done = !this.done;
		},
	},
});

// A todo without tags, for the examples that are about the list.
const Task = component({
	name: "Task",
	meta: DONE_CLASSES,
	fields: { label: t.string(), done: t.boolean() },
	queries: {
		get labelClass() {
			return this.done ? "flex-1 line-through opacity-50" : "flex-1";
		},
	},
	view: label(
		{ class: ROW },
		input({
			type: "checkbox",
			class: "checkbox checkbox-sm",
			checked: field("done"),
			"on:change": send("toggle"),
		}),
		span({ class: field("labelClass") }, field("label")),
	),
	on: {
		toggle(next) {
			next.done = !this.done;
		},
	},
});

const Theme = component({
	name: "Theme",
	fields: { dark: t.boolean() },
	queries: {
		get text() {
			return this.dark ? "🌙 dark" : "☀️ light";
		},
	},
	view: button({ class: "btn btn-sm", "on:click": send("flip") }, field("text")),
	on: {
		flip(next) {
			next.dark = !this.dark;
		},
	},
});

const LABELS = ["Write the script", "Record the video", "Publish it"];
const tasks = (C) => LABELS.map((text, i) => C.Task({ label: text, done: i === 1 }));
const todos = (C) =>
	LABELS.map((text, i) =>
		C.Todo({
			label: text,
			done: i === 1,
			tags: [C.Tag({ label: "video", on: i < 2 }), C.Tag({ label: "docs" })],
		}),
	);

// --- one step at a time ------------------------------------------------------------------

const counter = {
	id: "counter",
	title: "A counter",
	idea: "The root: one component, no steps. Every path starts here, at ·",
	components: { Counter },
	make: (C) => C.Counter({ label: "clicks" }),
};

const Scoreboard = component({
	name: "Scoreboard",
	fields: { home: t.component("Counter"), away: t.component("Counter") },
	view: div({ class: CARD }, render(field("home")), render(field("away"))),
});
const fields = {
	id: "field",
	title: "Fields",
	idea: "A field step: the same component at two paths, .home and .away",
	components: { Counter, Scoreboard },
	make: (C) =>
		C.Scoreboard({ home: C.Counter({ label: "home" }), away: C.Counter({ label: "away" }) }),
};

const Search = component({
	name: "Search",
	fields: { text: t.string() },
	view: div(
		{ class: ROW },
		span({ class: "badge badge-outline" }, "🔎 ", field("text")),
		button({ class: "btn btn-xs", "on:click": send("clear") }, "clear"),
	),
	on: {
		clear(next) {
			next.text = "";
		},
	},
});
const Sidebar = component({
	name: "Sidebar",
	fields: { search: t.component("Search") },
	view: nav({ class: CARD }, span({ class: TITLE }, "Sidebar"), render(field("search"))),
});
const Article = component({
	name: "Article",
	fields: { likes: t.component("Counter") },
	view: div({ class: CARD }, span({ class: TITLE }, "Article"), render(field("likes"))),
});
const Page = component({
	name: "Page",
	fields: { sidebar: t.component("Sidebar"), article: t.component("Article") },
	view: div(
		{ class: "grid grid-cols-2 gap-5" },
		render(field("sidebar")),
		render(field("article")),
	),
});
const depth = {
	id: "depth",
	title: "Fields in fields",
	idea: "A path is a list of steps: .sidebar then .search",
	components: { Counter, Search, Sidebar, Article, Page },
	make: (C) =>
		C.Page({
			sidebar: C.Sidebar({ search: C.Search({ text: "paths" }) }),
			article: C.Article({ likes: C.Counter({ label: "likes" }) }),
		}),
};

const Dashboard = component({
	name: "Dashboard",
	fields: { count: t.component("Counter") },
	view: div(
		{ class: CARD },
		div({ class: "flex justify-end" }, render(field("count"), "compact")),
		render(field("count")),
	),
});
const views = {
	id: "views",
	title: "Two views of one field",
	idea: "A view is not a step: two places in the page, one path, one state",
	components: { Counter, Dashboard },
	make: (C) => C.Dashboard({ count: C.Counter({ label: "visits", count: 3 }) }),
};

const Counters = component({
	name: "Counters",
	fields: { counters: t.array(t.component("Counter")) },
	view: div(
		{ class: CARD },
		renderEach(field("counters")),
		button({ class: "btn btn-sm self-start", "on:click": send("add") }, "Add a counter"),
	),
	on: {
		add(next, _args, ctx) {
			const C = ctx.scope.components;
			next.counters.push(C.Counter({ label: `#${this.counters.length + 1}` }));
		},
	},
});
const list = {
	id: "list",
	title: "A list of components",
	idea: "A loop and its items: renderEach makes each item a step, [0], [1], [2]",
	components: { Counter, Counters },
	make: (C) =>
		C.Counters({ counters: [1, 2, 3].map((n) => C.Counter({ label: `#${n}`, count: n })) }),
};

const Checklist = component({
	name: "Checklist",
	fields: { items: t.array(t.record({ title: t.string(), done: t.boolean() })) },
	view: ul(
		{ class: CARD },
		each(
			field("items"),
			li(
				{ class: ROW },
				label(
					{ class: "flex flex-1 items-center gap-2" },
					input({
						type: "checkbox",
						class: "checkbox checkbox-sm",
						checked: field("done"),
						"on:change": send("toggle", sourceKey()),
					}),
					span(field("title")),
				),
				button({ class: "btn btn-xs btn-ghost", "on:click": send("remove", sourceKey()) }, "✕"),
			),
		),
	),
	on: {
		toggle(next, [i]) {
			next.items[i].done = !this.items[i].done;
		},
		remove(next, [i]) {
			next.items.splice(i, 1);
		},
	},
});
const records = {
	id: "each",
	title: "A list of plain values",
	idea: "Items that aren't components are no step in the tree, but a frame in the path: sourceKey() reads it",
	components: { Checklist },
	make: (C) =>
		C.Checklist({
			items: [
				{ title: "Milk", done: true },
				{ title: "Bread", done: false },
				{ title: "Coffee", done: false },
			],
		}),
};

const TodoList = component({
	name: "TodoList",
	fields: { todos: t.array(t.component("Task")) },
	view: ul(
		{ class: CARD },
		each(
			field("todos"),
			li(
				{ class: ROW },
				div({ class: "flex-1" }, renderIt()),
				button({ class: "btn btn-xs btn-ghost", "on:click": send("remove", sourceKey()) }, "✕"),
			),
		),
	),
	on: {
		remove(next, [i]) {
			next.todos.splice(i, 1);
		},
	},
});
const it = {
	id: "it",
	title: "The list's markup around each item",
	idea: "each + renderIt: ✕ belongs to the list at [1], the checkbox to the Task inside it",
	components: { Task, TodoList },
	make: (C) => C.TodoList({ todos: tasks(C) }),
};

const OpenTodos = component({
	name: "OpenTodos",
	fields: { todos: t.array(t.component("Task")) },
	loops: { open: { filter: (_key, todo) => !todo.done } },
	view: div(
		{ class: "grid grid-cols-2 gap-5" },
		div({ class: CARD }, span({ class: TITLE }, "Open"), renderEach(field("todos"), "open")),
		div({ class: CARD }, span({ class: TITLE }, "All"), renderEach(field("todos"))),
	),
});
const filter = {
	id: "filter",
	title: "A filtered loop",
	idea: "A loop keeps keys, not positions: the second open todo is still [2]",
	components: { Task, OpenTodos },
	make: (C) => C.OpenTodos({ todos: tasks(C) }),
};

const Room = component({
	name: "Room",
	fields: { name: t.string(), lights: t.boolean() },
	queries: {
		get text() {
			return this.lights ? "💡 on" : "🌑 off";
		},
	},
	view: div(
		{ class: ROW },
		span({ class: "w-20" }, field("name")),
		button({ class: "btn btn-sm", "on:click": send("flip") }, field("text")),
	),
	on: {
		flip(next) {
			next.lights = !this.lights;
		},
	},
});
const House = component({
	name: "House",
	fields: { rooms: t.map(t.component("Room")) },
	view: div({ class: CARD }, renderEach(field("rooms"))),
});
const keys = {
	id: "keys",
	title: "A map of components",
	idea: 'Keys can be names: ["kitchen"] instead of [0]',
	components: { Room, House },
	make: (C) =>
		C.House({
			rooms: {
				kitchen: C.Room({ name: "Kitchen", lights: true }),
				bedroom: C.Room({ name: "Bedroom" }),
				garage: C.Room({ name: "Garage" }),
			},
		}),
};

// The buttons that pick one of a collection's items: each sends pick with the item's key.
const picker = (name, loop) =>
	div(
		{ class: "tabs tabs-box" },
		each(
			field(name),
			button(
				{ class: lookupBind("tabClass"), "on:click": send("pick", sourceKey()) },
				field("title"),
			),
			loop,
		),
	);
const pickerLoop = {
	enrich(key) {
		return { tabClass: key === this.current ? "tab tab-active" : "tab" };
	},
};
const Tab = component({
	name: "Tab",
	fields: { title: t.string(), likes: t.number() },
	view: div(
		{ class: ROW },
		strong(field("title")),
		button({ class: "btn btn-sm", "on:click": send("like") }, "👍 ", field("likes")),
	),
	on: {
		like(next) {
			next.likes += 1;
		},
	},
});
const Tabs = component({
	name: "Tabs",
	meta: TAB_CLASSES,
	fields: { tabs: t.array(t.component("Tab")), current: t.int({ min: 0 }) },
	loops: { nav: pickerLoop },
	view: div({ class: CARD }, picker("tabs", "nav"), render(seqItem("tabs", "current"))),
	on: {
		pick(next, [i]) {
			next.current = i;
		},
	},
});
const index = {
	id: "index",
	title: "The item another field picks",
	idea: "seqItem: the step reads .current to know which of .tabs it is",
	components: { Tab, Tabs },
	make: (C) =>
		C.Tabs({
			current: 1,
			tabs: ["Inbox", "Sent", "Drafts"].map((title) => C.Tab({ title })),
		}),
};

const Router = component({
	name: "Router",
	meta: TAB_CLASSES,
	fields: { pages: t.map(t.component("Tab")), current: t.string() },
	loops: { nav: pickerLoop },
	view: div({ class: CARD }, picker("pages", "nav"), render(seqItem("pages", "current"))),
	on: {
		pick(next, [key]) {
			next.current = key;
		},
	},
});
const route = {
	id: "route",
	title: "A router",
	idea: "The same step over a map: .current holds a name",
	components: { Tab, Router },
	make: (C) =>
		C.Router({
			current: "docs",
			pages: {
				home: C.Tab({ title: "Home" }),
				docs: C.Tab({ title: "Docs" }),
				blog: C.Tab({ title: "Blog" }),
			},
		}),
};

const Toolbar = component({
	name: "Toolbar",
	view: div(
		{ class: CARD },
		span({ class: TITLE }, "Toolbar"),
		div({ class: ROW }, span("Theme, from above:"), render(provided("theme"))),
	),
});
const Editor = component({
	name: "Editor",
	fields: { toolbar: t.component("Toolbar") },
	view: div({ class: CARD }, span({ class: TITLE }, "Editor"), render(field("toolbar"))),
});
const ThemedApp = component({
	name: "App",
	fields: { theme: t.component("Theme"), editor: t.component("Editor") },
	provides: { theme: "theme" },
	view: div(
		{ class: CARD },
		div({ class: ROW }, span({ class: TITLE }, "App"), render(field("theme"))),
		render(field("editor")),
	),
});
const provide = {
	id: "provided",
	title: "A value from above",
	idea: "A provided step: rendered in the toolbar, but its state is the App's .theme",
	components: { Theme, Toolbar, Editor, App: ThemedApp },
	make: (C) => C.App({ theme: C.Theme(), editor: C.Editor({ toolbar: C.Toolbar() }) }),
};

const Disclosure = component({
	name: "Disclosure",
	fields: { open: t.boolean(), details: t.component("Counter") },
	queries: {
		get text() {
			return this.open ? "▾ Hide details" : "▸ Show details";
		},
	},
	view: div(
		{ class: CARD },
		button({ class: "btn btn-sm self-start", "on:click": send("flip") }, field("text")),
		$if(field("open"), render(field("details")), ""),
	),
	on: {
		flip(next) {
			next.open = !this.open;
		},
	},
});
const condition = {
	id: "if",
	title: "A branch not taken",
	idea: "The tree follows the state: a step exists only while its branch renders",
	components: { Counter, Disclosure },
	make: (C) => C.Disclosure({ details: C.Counter({ label: "inside" }) }),
};

// --- the steps together ------------------------------------------------------------------

const TaggedTodos = component({
	name: "TaggedTodos",
	fields: { todos: t.array(t.component("Todo")) },
	view: div({ class: CARD }, renderEach(field("todos"))),
});
const nested = {
	id: "nested",
	title: "Lists in lists",
	idea: "A longer path: .todos[1] then .tags[0], one frame per loop item",
	components: { Tag, Todo, TaggedTodos },
	make: (C) => C.TaggedTodos({ todos: todos(C) }),
};

// A line tells whoever is above it what happened: it can't remove itself from a list it
// doesn't own.
const Line = component({
	name: "Line",
	fields: { name: t.string(), price: t.number(), quantity: t.int({ min: 0, default: 1 }) },
	view: div(
		{ class: ROW },
		span({ class: "flex-1" }, field("name")),
		button({ class: "btn btn-xs", "on:click": send("step", -1) }, "−"),
		span({ class: "w-6 text-center tabular-nums" }, field("quantity")),
		button({ class: "btn btn-xs", "on:click": send("step", 1) }, "+"),
		button({ class: "btn btn-xs btn-ghost", "on:click": send("remove") }, "✕"),
	),
	on: {
		step: {
			emits: { notify: ["changed"] },
			run(next, [by], ctx) {
				next.quantity = Math.max(0, this.quantity + by);
				ctx.notify("changed");
			},
		},
		remove: {
			emits: { notify: ["removeLine"] },
			run(_next, _args, ctx) {
				ctx.notify("removeLine");
			},
		},
	},
});
const Cart = component({
	name: "Cart",
	fields: { lines: t.array(t.component("Line")) },
	queries: {
		get total() {
			return this.lines.reduce((sum, line) => sum + line.price * line.quantity, 0).toFixed(2);
		},
	},
	view: div(
		{ class: CARD },
		span({ class: TITLE }, "Cart"),
		renderEach(field("lines")),
		strong({ class: "self-end" }, "Total $", field("total")),
	),
	on: {
		// It handles removeLine and stops it there; changed it has no handler for, so that one
		// passes through to the shop.
		removeLine: {
			sourceKey: t.index("lines"),
			run(next, _args, ctx) {
				next.lines.splice(ctx.sourceKey, 1);
				ctx.stopNext();
			},
		},
	},
});
const Shop = component({
	name: "Shop",
	fields: { cart: t.component("Cart"), edits: t.number() },
	view: div(
		{ class: CARD },
		div(
			{ class: ROW },
			span({ class: TITLE }, "Shop"),
			span({ class: "badge" }, field("edits"), " edits"),
		),
		render(field("cart")),
	),
	on: {
		changed(next) {
			next.edits += 1;
		},
	},
});
const bubble = {
	id: "notify",
	title: "A message going up",
	idea: "notify climbs the path: the cart passes changed on, the shop handles it",
	components: { Line, Cart, Shop },
	make: (C) =>
		C.Shop({
			cart: C.Cart({
				lines: [
					C.Line({ name: "Coffee beans", price: 12.5, quantity: 2 }),
					C.Line({ name: "Filters", price: 3 }),
					C.Line({ name: "Mug", price: 9.75 }),
				],
			}),
		}),
};

const Track = component({
	name: "Track",
	fields: { title: t.string(), playing: t.boolean() },
	queries: {
		get text() {
			return this.playing ? "▶ playing" : "⏸ stopped";
		},
	},
	views: {
		main: div(
			{ class: ROW },
			span({ class: "flex-1" }, field("title")),
			span({ class: "text-xs opacity-60" }, field("text")),
			button({ class: "btn btn-xs", "on:click": send("choose") }, "play"),
		),
		now: div(
			{ class: ROW },
			span({ class: TITLE }, "Now"),
			strong(field("title")),
			span(field("text")),
		),
	},
	on: {
		choose: {
			emits: { notify: ["chosen"] },
			run(next, _args, ctx) {
				next.playing = true;
				ctx.notify("chosen");
			},
		},
		stop(next) {
			next.playing = false;
		},
	},
});
const Playlist = component({
	name: "Playlist",
	fields: { tracks: t.array(t.component("Track")), current: t.int({ min: 0 }) },
	view: div(
		{ class: CARD },
		renderEach(field("tracks")),
		div(
			{ class: "flex items-center gap-2 border-t border-base-300 pt-2" },
			div({ class: "flex-1" }, render(seqItem("tracks", "current"), "now")),
			button({ class: "btn btn-sm", "on:click": send("stopCurrent") }, "Stop"),
		),
	),
	on: {
		// Down by selector: the track .current picks, wherever it is by then.
		stopCurrent: {
			emits: { sendAt: ["stop"] },
			run(_next, _args, ctx) {
				ctx.sendAt("stop", [], { seqItem: "tracks", keyField: "current" });
			},
		},
		// Up from a track: it's the current one now, and the one before stops.
		chosen: {
			sourceKey: t.index("tracks"),
			emits: { sendAt: ["stop"] },
			run(next, _args, ctx) {
				const before = this.current;
				next.current = ctx.sourceKey;
				if (before !== ctx.sourceKey) ctx.sendAt("stop", [], { item: "tracks", key: before });
				ctx.stopNext();
			},
		},
	},
});
const down = {
	id: "sendAt",
	title: "A message going down",
	idea: "sendAt writes a path from here: the playlist tells the track .current picks to stop",
	components: { Track, Playlist },
	make: (C) =>
		C.Playlist({
			current: 0,
			tracks: [
				C.Track({ title: "Intro", playing: true }),
				C.Track({ title: "Paths" }),
				C.Track({ title: "Outro" }),
			],
		}),
};

const Card = component({
	name: "Card",
	fields: { title: t.string(), votes: t.number() },
	view: div(
		{ class: ROW },
		span({ class: "flex-1" }, field("title")),
		button({ class: "btn btn-xs", "on:click": send("vote") }, "▲ ", field("votes")),
		render(provided("theme")),
	),
	on: {
		vote(next) {
			next.votes += 1;
		},
	},
});
const Board = component({
	name: "Board",
	fields: { theme: t.component("Theme"), cards: t.array(t.component("Card")) },
	provides: { theme: "theme" },
	view: div({ class: CARD }, span({ class: TITLE }, "Board"), renderEach(field("cards"))),
});
const jump = {
	id: "jump",
	title: "A provided value in a list",
	idea: "The path says how it was reached, .cards[1] then *theme; the state is the board's .theme",
	components: { Theme, Card, Board },
	make: (C) =>
		C.Board({
			theme: C.Theme(),
			cards: ["Paths", "Events", "Providers"].map((title) => C.Card({ title })),
		}),
};

const WorkPage = component({
	name: "Page",
	fields: { title: t.string(), sidebar: t.component("Sidebar"), notes: t.component("Counter") },
	view: div(
		{ class: CARD },
		div(
			{ class: ROW },
			h2({ class: "flex-1 font-bold" }, field("title")),
			render(provided("theme")),
		),
		render(field("sidebar")),
		render(field("notes")),
	),
});
const Workspace = component({
	name: "Workspace",
	meta: TAB_CLASSES,
	fields: {
		theme: t.component("Theme"),
		pages: t.map(t.component("Page")),
		current: t.string(),
		todos: t.array(t.component("Todo")),
	},
	provides: { theme: "theme" },
	loops: {
		nav: pickerLoop,
		open: { filter: (_key, todo) => !todo.done },
	},
	view: div(
		{ class: "flex flex-col gap-5" },
		picker("pages", "nav"),
		render(seqItem("pages", "current")),
		div(
			{ class: "grid grid-cols-2 gap-5" },
			div({ class: CARD }, span({ class: TITLE }, "Open"), renderEach(field("todos"), "open")),
			div(
				{ class: CARD },
				span({ class: TITLE }, "All"),
				table(
					{ class: "table table-sm" },
					pushView("row", each(field("todos"), tbody(renderIt()))),
				),
			),
		),
	),
	on: {
		pick(next, [key]) {
			next.current = key;
		},
	},
});
const workspace = {
	id: "workspace",
	title: "A workspace",
	idea: "Every step in one app: a router, a provided theme, a filtered loop, lists in lists and a table",
	components: { Counter, Search, Sidebar, Tag, Theme, Todo, Page: WorkPage, Workspace },
	make: (C) => {
		const page = (title, text) =>
			C.Page({
				title,
				sidebar: C.Sidebar({ search: C.Search({ text }) }),
				notes: C.Counter({ label: "notes" }),
			});
		return C.Workspace({
			theme: C.Theme(),
			current: "docs",
			pages: { home: page("Home", "news"), docs: page("Docs", "paths") },
			todos: todos(C),
		});
	},
};

export const examples = [
	counter,
	fields,
	depth,
	views,
	list,
	records,
	it,
	filter,
	keys,
	index,
	route,
	provide,
	condition,
	nested,
	bubble,
	down,
	jump,
	workspace,
];
// The example with id, the first one when there's none.
export const exampleOf = (id) => examples.find((e) => e.id === id) ?? examples[0];
