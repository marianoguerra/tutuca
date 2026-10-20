// A notebook of interactive cells: notes, todos, a kanban board, a drawing, a tracker for a group
// of things, or another notebook, in the order you add them. A cell starts as a Picker, which
// becomes the component you choose; a tracker asks first which group of things to track.
//
// The notebook is an ordered map of Cells. A cell owns what all cells share: a header to drag it
// by, collapsing (Ctrl+click asks the notebook to collapse or expand every cell) and removing.
// The other libraries' components are registered next to these, so cells are made in the
// notebook's scope.
import { notesComponents } from "../../demos/notes/notes.js";
import {
	$if,
	component,
	dragKey,
	each,
	field,
	render,
	renderIt,
	send,
	sourceKey,
	specOf,
	t,
	tag,
} from "../../src/tutuca.js";
import { isoDay } from "../common/calendar.js";
import { drawingComponents } from "../drawing/index.js";
import { kanbanComponents } from "../kanban/index.js";
import { trackerComponents } from "../thing-tracker/index.js";
import { BUNDLES } from "../thing-tracker/model.js";
import { thingFrom } from "../thing-tracker/records.js";
import { formatTime } from "../thing-tracker/time.js";
import { todoApp, todoComponents } from "../todo/index.js";

const { button, div, h2, header, p, span } = tag;

// What a cell can be: its label, emoji and blurb in the picker.
export const KINDS = {
	notes: ["Notes", "📝", "A list of short notes to tick off."],
	todos: ["Todos", "✅", "Projects, labels and due dates."],
	kanban: ["Kanban board", "🗂️", "Cards you drag between columns."],
	drawing: ["Drawing", "🎨", "Shapes you draw, move and layer."],
	tracker: ["Tracker", "📈", "A group of things to log with a tap."],
	notebook: ["Notebook", "📓", "A notebook of its own, inside this one."],
};
const KIND_NAMES = Object.keys(KINDS);
// The groups of things a tracker can track, from every bundle of the thing tracker.
export const GROUPS = BUNDLES.flatMap(({ pack }) =>
	pack.groups.map((group) => ({
		...group,
		things: group.thingIds.map((id) => pack.things.find((thing) => thing.id === id)),
	})),
);
const GROUP_IDS = GROUPS.map((g) => g.id);

// A tracker of one group of things: the thing tracker's section of it, the things it provides
// to the section, and what logging one does here instead of in the tracker app.
export const TrackerCell = component({
	name: "TrackerCell",
	fields: {
		section: t.component("Section"),
		things: t.array(t.component("Thing")),
		tz: t.number().int().min(-840).max(840),
	},
	provides: {
		things(b) {
			b.field("things");
		},
	},
	view: render(field("section")),
	on: {
		// From the section's things.
		logThing: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				const i = this.things.findIndex((thing) => thing.id === id);
				if (i === -1) return;
				draft.things[i].total += 1;
				draft.things[i].lastText = formatTime(ctx.now(), this.tz);
			},
		},
		backdateThing: {
			args: [t.string()],
			run(_draft, _args, ctx) {
				ctx.stopNext();
			},
		},
		toggleSection: {
			args: [t.string()],
			run(draft, _args, ctx) {
				ctx.stopNext();
				draft.section.isOpen = !this.section.isOpen;
			},
		},
		toggleAllSections: {
			args: [],
			run(draft, _args, ctx) {
				ctx.stopNext();
				draft.section.isOpen = !this.section.isOpen;
			},
		},
	},
});

export const trackerCell = (C, groupId, { tz = 0 } = {}) => {
	const group = GROUPS.find((g) => g.id === groupId);
	return C.TrackerCell({
		tz,
		things: group.things.map((thing) => thingFrom(C, thing)),
		section: C.Section({
			id: group.id,
			title: group.title,
			emoji: group.emoji,
			memberIds: group.thingIds,
		}),
	});
};

// A new cell's content of kind, made with C: group is what a tracker tracks, now and tz the
// clock, uuid makes a nested notebook's keys.
export const makeContent = (C, kind, { group = GROUP_IDS[0], now, tz = 0, uuid }) => {
	switch (kind) {
		case "notes":
			return C.Notes({ title: "Notes" });
		case "todos":
			return todoApp(C, { today: isoDay(new Date(now)) });
		case "kanban":
			return C.Board({ columns: ["To do", "Doing", "Done"].map((title) => C.Column({ title })) });
		case "drawing":
			return C.Drawing();
		case "tracker":
			return trackerCell(C, group, { tz });
		case "notebook":
			return notebook(C, { title: "Inner notebook", tz, keys: [uuid()] });
		default:
			throw new Error(`no cell kind ${kind}`);
	}
};

const choice = (id, action, emoji, label, blurb) =>
	button(
		{
			class: "btn h-auto flex-col items-start gap-0 py-2 text-left",
			"data-choice": id,
			"on:click": action,
		},
		span({ class: "font-bold" }, `${emoji} ${label}`),
		span({ class: "text-xs font-normal opacity-70" }, blurb),
	);

// A new cell's content, until you pick what it becomes.
export const Picker = component({
	name: "Picker",
	fields: { step: t.enum("kind", "tracker") },
	methods: {
		get isPickingKind() {
			return this.step === "kind";
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		$if(
			field("isPickingKind"),
			div(
				{ class: "flex flex-col gap-2" },
				p({ class: "text-sm opacity-70" }, "What do you want to add?"),
				div(
					{ class: "grid gap-2 sm:grid-cols-3" },
					Object.entries(KINDS).map(([kind, [label, emoji, blurb]]) =>
						choice(kind, send("pick", kind), emoji, label, blurb),
					),
				),
			),
			div(
				{ class: "flex flex-col gap-2" },
				p({ class: "text-sm opacity-70" }, "What do you want to track?"),
				div(
					{ class: "grid gap-2 sm:grid-cols-4" },
					GROUPS.map(({ id, emoji, title, things }) =>
						choice(
							id,
							send("pickGroup", id),
							emoji,
							title,
							things.map((thing) => thing.emoji).join(" "),
						),
					),
				),
				button({ class: "btn btn-ghost btn-sm self-start", "on:click": send("back") }, "← Back"),
			),
		),
	),
	on: {
		pick: {
			args: [t.enum(...KIND_NAMES)],
			emits: { notify: ["become"] },
			run(draft, [kind], ctx) {
				if (kind === "tracker") draft.step = "tracker";
				else ctx.notify("become", [kind, null]);
			},
		},
		pickGroup: {
			args: [t.enum(...GROUP_IDS)],
			emits: { notify: ["become"] },
			run(_draft, [group], ctx) {
				ctx.notify("become", ["tracker", group]);
			},
		},
		back: {
			args: [],
			run(draft) {
				draft.step = "kind";
			},
		},
	},
});

// The label of a cell, by what its content is.
const CONTENT_LABELS = {
	Picker: "New cell",
	Notes: "📝 Notes",
	TodoApp: "✅ Todos",
	Board: "🗂️ Kanban board",
	Drawing: "🎨 Drawing",
	Notebook: "📓 Notebook",
};

// One cell of a notebook: a header to drag it by, collapse it or remove it, and its content.
export const Cell = component({
	name: "Cell",
	fields: { content: t.component(), collapsed: t.boolean() },
	methods: {
		get label() {
			const { name } = specOf(this.content);
			if (name === "TrackerCell") return `📈 ${this.content.section.title}`;
			return CONTENT_LABELS[name] ?? name;
		},
		get isOpen() {
			return !this.collapsed;
		},
		get chevron() {
			return this.collapsed ? "▸" : "▾";
		},
	},
	view: div(
		{
			class: "rounded-box border border-base-300 bg-base-100 shadow-sm data-[dragging]:opacity-40",
		},
		header(
			{
				class: "flex cursor-grab items-center gap-2 px-3 py-2",
				draggable: "true",
				"data-dragtype": "cell",
				title: "Drag to move this cell",
			},
			span({ class: "opacity-40", "aria-hidden": "true" }, "⠿"),
			button(
				{
					class: "btn btn-ghost btn-xs w-6 px-0",
					title: "Collapse or expand (Ctrl+click: every cell)",
					"aria-expanded": $if(field("isOpen"), "true", "false"),
					"on:click": send("toggle"),
				},
				field("chevron"),
			),
			span({ class: "flex-1 text-sm font-bold opacity-60" }, field("label")),
			button(
				{ class: "btn btn-ghost btn-xs", title: "Remove this cell", "on:click": send("remove") },
				"✕",
			),
		),
		$if(field("isOpen"), div({ class: "px-4 pb-4" }, render(field("content"))), ""),
	),
	on: {
		// With Ctrl (⌘ on a Mac) held, every cell of the notebook does the same.
		toggle: {
			args: [],
			emits: { notify: ["collapseAll"] },
			run(draft, _args, ctx) {
				const collapsed = !this.collapsed;
				if (ctx.event?.ctrlKey || ctx.event?.metaKey) ctx.notify("collapseAll", [collapsed]);
				else draft.collapsed = collapsed;
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeCell"] },
			run(_draft, _args, ctx) {
				ctx.notify("removeCell");
			},
		},
		// From the picker, on its way to the notebook, which makes what it becomes.
		become: { args: [t.enum(...KIND_NAMES), t.option(t.enum(...GROUP_IDS))], run() {} },
	},
});

// Between two cells: where a dragged cell drops, and a button to add one there.
const gap = (drop, add, title) =>
	div(
		{
			class:
				"flex min-h-8 items-center justify-center rounded-box border-2 border-dashed border-transparent data-[draggingover=cell]:min-h-14 data-[draggingover=cell]:border-primary data-[draggingover=cell]:bg-primary/10",
			"on:drop": drop,
		},
		button(
			{
				class: "btn btn-circle btn-ghost btn-sm opacity-50 hover:opacity-100",
				title,
				"on:click": add,
			},
			"+",
		),
	);

// Whether the drag is of one of this notebook's own cells, not of one in a notebook inside it.
const isOwnCell = (ctx) =>
	ctx.drag?.type === "cell" &&
	String(ctx.drag.path.toComponentPath().toParentPath()) === String(ctx.path);

export const Notebook = component({
	name: "Notebook",
	fields: {
		title: t.string("Notebook"),
		// An ordered map: cells by key, and the keys in order. Keys are uuids, so cells added
		// on two devices don't collide when they sync.
		entries: t.map(t.component("Cell")),
		order: t.array(t.string()),
		tz: t.number().int().min(-840).max(840), // Minutes east of UTC, for the trackers.
	},
	loops: {
		ordered: {
			iter(entries) {
				return this.order.map((key) => [key, entries[key]]);
			},
		},
	},
	invariants: {
		orderHasEveryEntry() {
			const keys = Object.keys(this.entries);
			return keys.length === this.order.length && this.order.every((k) => k in this.entries);
		},
	},
	view: div(
		{ class: "flex flex-col gap-1" },
		h2({ class: "text-2xl font-bold" }, field("title")),
		each(
			field("entries"),
			div(
				{ class: "flex flex-col gap-1" },
				gap(
					send("moveBefore", dragKey(), sourceKey()),
					send("addBefore", sourceKey()),
					"Add a cell here",
				),
				renderIt(),
			),
			"ordered",
		),
		gap(send("moveToEnd", dragKey()), send("add"), "Add a cell at the end"),
	),
	on: {
		add: {
			args: [],
			run(draft, _args, ctx) {
				const key = ctx.uuid();
				draft.entries[key] = ctx.scope.components.Cell({ content: ctx.scope.make("Picker") });
				draft.order.push(key);
			},
		},
		addBefore: {
			args: [t.index("entries")],
			run(draft, [before], ctx) {
				const key = ctx.uuid();
				draft.entries[key] = ctx.scope.components.Cell({ content: ctx.scope.make("Picker") });
				draft.order.splice(this.order.indexOf(before), 0, key);
			},
		},
		// A cell dragged onto the gap before the cell at before; drags from elsewhere are ignored.
		moveBefore: {
			args: [t.option(t.index("entries")), t.index("entries")],
			run(draft, [key, before], ctx) {
				if (key === null || key === before || !isOwnCell(ctx)) return;
				const order = this.order.filter((k) => k !== key);
				order.splice(order.indexOf(before), 0, key);
				draft.order = order;
			},
		},
		moveToEnd: {
			args: [t.option(t.index("entries"))],
			run(draft, [key], ctx) {
				if (key === null || !isOwnCell(ctx)) return;
				draft.order = [...this.order.filter((k) => k !== key), key];
			},
		},
		// From the cells.
		removeCell: {
			args: [],
			sourceKey: t.index("entries"),
			run(draft, _args, ctx) {
				ctx.stopNext();
				delete draft.entries[ctx.sourceKey];
				draft.order = this.order.filter((k) => k !== ctx.sourceKey);
			},
		},
		collapseAll: {
			args: [t.boolean()],
			run(draft, [collapsed], ctx) {
				ctx.stopNext();
				for (const key of this.order) draft.entries[key].collapsed = collapsed;
			},
		},
		// From the picker of the cell at ctx.sourceKey: the cell's content becomes kind.
		become: {
			args: [t.enum(...KIND_NAMES), t.option(t.enum(...GROUP_IDS))],
			sourceKey: t.index("entries"),
			run(draft, [kind, group], ctx) {
				ctx.stopNext();
				draft.entries[ctx.sourceKey].content = makeContent(ctx.scope.components, kind, {
					group: group ?? undefined,
					now: ctx.now(),
					tz: this.tz,
					uuid: () => ctx.uuid(),
				});
			},
		},
	},
});

// A notebook of cells made from kinds, or of one picker; keys default to entry-1, entry-2…
export function notebook(C, { title, kinds = [], now = 0, tz = 0, keys } = {}) {
	let made = 0;
	const uuid = () => `nested-${++made}`;
	const contents =
		kinds.length === 0
			? [C.Picker()]
			: kinds.map((kind) => makeContent(C, kind, { now, tz, uuid }));
	const order = contents.map((_, i) => keys?.[i] ?? `entry-${i + 1}`);
	return C.Notebook({
		...(title === undefined ? {} : { title }),
		tz,
		order,
		entries: Object.fromEntries(order.map((key, i) => [key, C.Cell({ content: contents[i] })])),
	});
}

// Every component a notebook can hold. The libraries' names must not collide: they share
// the notebook's scope.
const libraries = [
	notesComponents,
	todoComponents,
	kanbanComponents,
	drawingComponents,
	trackerComponents,
	{ Notebook, Cell, Picker, TrackerCell },
];
export const compositionComponents = {};
for (const library of libraries) {
	for (const [name, spec] of Object.entries(library)) {
		if (name in compositionComponents) throw new Error(`two components named ${name}`);
		compositionComponents[name] = spec;
	}
}
