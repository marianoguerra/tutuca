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
	AGENT_META,
	agentTool,
	apply,
	component,
	DISPLAY_META,
	displayLabel,
	displayOf,
	dragKey,
	each,
	field,
	render,
	renderIt,
	scopeOf,
	send,
	sourceKey,
	specOf,
	t,
	tag,
	targetValue,
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

// What a cell can be, and the component each makes: the picker lists them by what those say of
// themselves in their display meta.
export const KINDS = {
	notes: "Notes",
	todos: "TodoApp",
	kanban: "Board",
	drawing: "Drawing",
	tracker: "TrackerCell",
	notebook: "Notebook",
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
	meta: {
		[DISPLAY_META]: {
			title: "Tracker",
			icon: "📈",
			description: "A group of things to log with a tap.",
		},
		// An agent logs things by their id: when someone says they did one.
		[AGENT_META]: {
			prompt:
				"A tracker of one group of things a person does (drink water, take a walk, ...): each thing has an id, a title, how many times it's been logged and when last. Log a thing when the person says they did it, once per time they did it.",
			tools: [
				agentTool("log_thing", "message", ["id"], "Log a thing as done now.", {
					target: "logThing",
				}),
			],
		},
	},
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
	queries: {
		// Each thing with its id and how often it's been logged, for an agent.
		get summary() {
			const lines = this.things.map(
				(th) => `${th.id} ${th.emoji} ${th.title}: logged ${th.total} times, last ${th.lastText}`,
			);
			return `${this.section.title}:\n${lines.join("\n")}`;
		},
	},
	view: render(field("section")),
	on: {
		// From the section's things.
		logThing: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				const i = this.things.findIndex((thing) => thing.id === id);
				if (i === -1) return;
				next.things[i] = apply(next.things[i], "logged", formatTime(ctx.now(), this.tz));
			},
		},
		backdateThing: {
			args: [t.string()],
			run(_next, _args, ctx) {
				ctx.stopNext();
			},
		},
		toggleSection: {
			args: [t.string()],
			run(next, _args, ctx) {
				ctx.stopNext();
				next.section = apply(next.section, "setOpen", !this.section.isOpen);
			},
		},
		toggleAllSections: {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				next.section = apply(next.section, "setOpen", !this.section.isOpen);
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

const CHOICE = "btn h-auto flex-col items-start gap-0 py-2 text-left";
const choice = (id, action, emoji, label, blurb) =>
	button(
		{
			class: CHOICE,
			"data-choice": id,
			"on:click": action,
		},
		span({ class: "font-bold" }, `${emoji} ${label}`),
		span({ class: "text-xs font-normal opacity-70" }, blurb),
	);

// A new cell's content, until you pick what it becomes.
export const Picker = component({
	name: "Picker",
	meta: {
		[DISPLAY_META]: {
			title: "New cell",
			description: "Picks what a new cell becomes.",
		},
	},
	fields: { step: t.enum("kind", "tracker") },
	queries: {
		get isPickingKind() {
			return this.step === "kind";
		},
		// What a cell can be, as the components it'd make say in their display meta.
		get kinds() {
			const scope = scopeOf(this);
			return Object.entries(KINDS).map(([id, name]) => {
				const spec = scope?.lookupByName(name) ?? null;
				const { title, icon, description } = spec ? displayOf(spec, scope) : {};
				return {
					id,
					label: [icon, title ?? name].filter(Boolean).join(" "),
					description: description ?? "",
				};
			});
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
					each(
						field("kinds"),
						button(
							{
								class: CHOICE,
								"data-choice": field("id"),
								value: field("id"),
								"on:click": send("pick", targetValue()),
							},
							span({ class: "font-bold" }, field("label")),
							span({ class: "text-xs font-normal opacity-70" }, field("description")),
						),
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
			run(next, [kind], ctx) {
				if (kind === "tracker") next.step = "tracker";
				else ctx.notify("become", [kind, null]);
			},
		},
		pickGroup: {
			args: [t.enum(...GROUP_IDS)],
			emits: { notify: ["become"] },
			run(_next, [group], ctx) {
				ctx.notify("become", ["tracker", group]);
			},
		},
		back: {
			args: [],
			run(next) {
				next.step = "kind";
			},
		},
	},
});

// One cell of a notebook: a header to drag it by, collapse it or remove it, and its content.
export const Cell = component({
	name: "Cell",
	fields: { content: t.component(), collapsed: t.boolean() },
	queries: {
		// What the content says it is in its display meta; a tracker, which group it tracks.
		get label() {
			const { name } = specOf(this.content);
			if (name === "TrackerCell") {
				const { icon } = displayOf(this.content);
				return [icon, this.content.section.title].filter(Boolean).join(" ");
			}
			return displayLabel(this.content) ?? name;
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
			run(next, _args, ctx) {
				const collapsed = !this.collapsed;
				if (ctx.event?.ctrlKey || ctx.event?.metaKey) ctx.notify("collapseAll", [collapsed]);
				else next.collapsed = collapsed;
			},
		},
		setCollapsed: {
			pure: true,
			args: [t.boolean()],
			run(next, [collapsed]) {
				next.collapsed = collapsed;
			},
		},
		// Its content becomes content, a new component.
		setContent: {
			pure: true,
			args: [t.component()],
			run(next, [content]) {
				next.content = content;
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeCell"] },
			run(_next, _args, ctx) {
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
	meta: {
		[DISPLAY_META]: {
			title: "Notebook",
			icon: "📓",
			description:
				"Cells of notes, todos, boards, drawings and trackers, in the order you add them.",
		},
	},
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
			run(next, _args, ctx) {
				const key = ctx.uuid();
				next.entries[key] = ctx.scope.components.Cell({ content: ctx.scope.make("Picker") });
				next.order.push(key);
			},
		},
		addBefore: {
			args: [t.index("entries")],
			run(next, [before], ctx) {
				const key = ctx.uuid();
				next.entries[key] = ctx.scope.components.Cell({ content: ctx.scope.make("Picker") });
				next.order.splice(this.order.indexOf(before), 0, key);
			},
		},
		// A cell dragged onto the gap before the cell at before; drags from elsewhere are ignored.
		moveBefore: {
			args: [t.option(t.index("entries")), t.index("entries")],
			run(next, [key, before], ctx) {
				if (key === null || key === before || !isOwnCell(ctx)) return;
				const order = this.order.filter((k) => k !== key);
				order.splice(order.indexOf(before), 0, key);
				next.order = order;
			},
		},
		moveToEnd: {
			args: [t.option(t.index("entries"))],
			run(next, [key], ctx) {
				if (key === null || !isOwnCell(ctx)) return;
				next.order = [...this.order.filter((k) => k !== key), key];
			},
		},
		// From the cells.
		removeCell: {
			args: [],
			sourceKey: t.index("entries"),
			run(next, _args, ctx) {
				ctx.stopNext();
				delete next.entries[ctx.sourceKey];
				next.order = this.order.filter((k) => k !== ctx.sourceKey);
			},
		},
		collapseAll: {
			args: [t.boolean()],
			run(next, [collapsed], ctx) {
				ctx.stopNext();
				for (const key of this.order)
					next.entries[key] = apply(next.entries[key], "setCollapsed", collapsed);
			},
		},
		// From the picker of the cell at ctx.sourceKey: the cell's content becomes kind.
		become: {
			args: [t.enum(...KIND_NAMES), t.option(t.enum(...GROUP_IDS))],
			sourceKey: t.index("entries"),
			run(next, [kind, group], ctx) {
				ctx.stopNext();
				const content = makeContent(ctx.scope.components, kind, {
					group: group ?? undefined,
					now: ctx.now(),
					tz: this.tz,
					uuid: () => ctx.uuid(),
				});
				next.entries[ctx.sourceKey] = apply(next.entries[ctx.sourceKey], "setContent", content);
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
