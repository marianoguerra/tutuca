// The canvas's holes and builtin layouts, after tutuca-wax's layout module: components one
// under the other (VBox), side by side (HBox), in a grid (Grid) or as tabs (Tabs), each slot
// starting as a Hole.
// A layout has a main view, the layout as it's used, and an edit view with what edits it: ×
// removes a slot, + adds a hole, and the grid's - and + change its columns. The Item a layout is
// in pushes edit above it while its toggle is on, so every layout below it shows its edit view.
//
// A hole becomes what's picked there: its notification goes up to the nearest layout or canvas,
// which swaps it for the new component.
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
import { GROUPS, KINDS, makeContent } from "../composition/index.js";

const { button, div, input, li, span, ul } = tag;

// What a hole can become: the notebook's kinds, a canvas inside this one, and the layouts.
export const HOLE_KINDS = {
	...KINDS,
	canvas: ["Canvas", "🖼️", "A canvas of its own, inside this one."],
	vbox: ["Vertical box", "⬇️", "Components one under the other."],
	hbox: ["Horizontal box", "➡️", "Components side by side."],
	grid: ["Grid", "▦", "Components in rows and columns."],
	tabs: ["Tabs", "🗂", "Components as tabs, one shown at a time."],
};
export const KIND_NAMES = Object.keys(HOLE_KINDS);
export const GROUP_IDS = GROUPS.map((g) => g.id);

// What a hole becomes when kind is picked, made with ctx's components and clock; group is what
// a tracker tracks.
export const makeHoleContent = (ctx, kind, group) => {
	const C = ctx.scope.components;
	switch (kind) {
		case "canvas":
			return C.Canvas({ width: 1200, height: 800 });
		case "vbox":
			return C.VBox({ items: [C.Hole()] });
		case "hbox":
			return C.HBox({ items: [C.Hole(), C.Hole()] });
		case "grid":
			return C.Grid({ items: [C.Hole(), C.Hole(), C.Hole(), C.Hole()] });
		case "tabs":
			return C.Tabs({ items: [C.Hole()], labels: [""] });
		default:
			return makeContent(C, kind, {
				group: group ?? undefined,
				now: ctx.now(),
				tz: -new Date(ctx.now()).getTimezoneOffset(),
				uuid: () => ctx.uuid(),
			});
	}
};

const choice = (id, action, label) => li(button({ "data-choice": id, "on:click": action }, label));

// An empty slot: + lists what it can become, picking one asks what it's in to make it.
export const Hole = component({
	name: "Hole",
	fields: { step: t.enum("closed", "kind", "tracker").sync("none") },
	queries: {
		get isClosed() {
			return this.step === "closed";
		},
		get isPickingKind() {
			return this.step === "kind";
		},
	},
	view: div(
		{
			class:
				"layout-root flex min-h-24 items-center justify-center rounded-box border-2 border-dashed border-primary/60 bg-base-100/60 p-2",
		},
		$if(
			field("isClosed"),
			button(
				{
					class: "btn btn-circle btn-ghost btn-sm text-lg",
					title: "Put a component here",
					"on:click": send("open"),
				},
				"+",
			),
			div(
				{ class: "flex w-full flex-col items-stretch gap-1" },
				$if(
					field("isPickingKind"),
					ul(
						{ class: "choices menu menu-sm w-full rounded-box border border-base-300 bg-base-100" },
						Object.entries(HOLE_KINDS).map(([kind, [label, emoji]]) =>
							choice(kind, send("pick", kind), `${emoji} ${label}`),
						),
					),
					ul(
						{
							class:
								"choices menu menu-sm max-h-64 w-full flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100",
						},
						GROUPS.map(({ id, emoji, title }) =>
							choice(id, send("pickGroup", id), `${emoji} ${title}`),
						),
					),
				),
				button({ class: "btn btn-ghost btn-xs", "on:click": send("close") }, "cancel"),
			),
		),
	),
	on: {
		open(next) {
			next.step = "kind";
		},
		close(next) {
			next.step = "closed";
		},
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
	},
});

// A slot's buttons show while it's hovered and no slot inside it is, so a nested layout's
// don't cover its parent's.
const ON_HOVER =
	"opacity-0 pointer-events-none focus-visible:opacity-100 [.layout-slot:hover:not(:has(.layout-slot:hover))>&]:opacity-100 [.layout-slot:hover:not(:has(.layout-slot:hover))>&]:pointer-events-auto";
const EDITED = "outline-1 outline-dashed -outline-offset-1 outline-base-content/50 p-2";
// What's in a slot fills it, as wide as the others and as tall as the tallest. A layout or a
// hole in it (layout-root) stays see-through; anything else gets a background of its own, so
// it doesn't blend into the canvas.
const BACKED =
	"[&>:not(.layout-root)]:rounded-box [&>:not(.layout-root)]:bg-base-100 [&>:not(.layout-root)]:p-2";
const SLOT = `layout-slot relative grid min-w-0 [:where(&)>*]:w-full [:where(&)>*]:h-full ${BACKED}`;

// The items in their slots, used: each in a div with cls.
const slots = (cls) => each(field("items"), div({ class: `${SLOT} ${cls}` }, renderIt()));
// The items in their slots, edited: each with a × to remove it.
const editedSlots = (cls) =>
	each(
		field("items"),
		div(
			{ class: `${SLOT} ${cls}` },
			renderIt(),
			button(
				{
					class: `slot-remove btn btn-xs btn-circle btn-ghost absolute -right-1 -top-1 z-10 text-error ${ON_HOVER}`,
					title: "Remove this slot",
					"on:click": send("removeAt", sourceKey()),
				},
				"×",
			),
		),
	);
const addButton = (title, cls = "") =>
	button(
		{
			class: `slot-add btn btn-xs btn-circle btn-ghost self-center ${cls}`,
			title,
			"on:click": send("add"),
		},
		"+",
	);

// What every layout handles: a hole added at the end, a slot removed, and a hole in a slot
// becoming what's picked in it.
const layoutHandlers = () => ({
	add(next, _args, ctx) {
		next.items.push(ctx.scope.components.Hole());
	},
	removeAt: {
		args: [t.index("items")],
		run(next, [at]) {
			next.items.splice(at, 1);
		},
	},
	become: {
		args: [t.enum(...KIND_NAMES), t.option(t.enum(...GROUP_IDS))],
		sourceKey: t.index("items"),
		run(next, [kind, group], ctx) {
			ctx.stopNext();
			next.items[ctx.sourceKey] = makeHoleContent(ctx, kind, group);
		},
	},
});

export const VBox = component({
	name: "VBox",
	fields: { items: t.array(t.component()) },
	view: div({ class: "layout-root vbox flex flex-col items-stretch gap-2" }, slots("")),
	views: {
		edit: div(
			{ class: `layout-root vbox flex flex-col items-stretch gap-2 ${EDITED}` },
			editedSlots(""),
			addButton("Add a slot below"),
		),
	},
	on: layoutHandlers(),
});

export const HBox = component({
	name: "HBox",
	fields: { items: t.array(t.component()) },
	view: div({ class: "layout-root hbox flex flex-row items-stretch gap-2" }, slots("flex-1")),
	views: {
		edit: div(
			{ class: `layout-root hbox flex flex-row items-stretch gap-2 ${EDITED}` },
			editedSlots("flex-1"),
			addButton("Add a slot to the right"),
		),
	},
	on: layoutHandlers(),
});

const MAX_COLUMNS = 6;

export const Grid = component({
	name: "Grid",
	fields: {
		items: t.array(t.component()),
		columns: t.number().int().min(1).max(MAX_COLUMNS).default(2),
	},
	queries: {
		get gridStyle() {
			return `grid-template-columns:repeat(${this.columns},minmax(0,1fr))`;
		},
		// Rows, the last one maybe not full.
		get rows() {
			return Math.ceil(this.items.length / this.columns);
		},
		get atMinColumns() {
			return this.columns <= 1;
		},
		get atMaxColumns() {
			return this.columns >= MAX_COLUMNS;
		},
	},
	view: div({ class: "layout-root grid-box grid gap-2", style: field("gridStyle") }, slots("")),
	views: {
		edit: div(
			{ class: `layout-root grid-box flex flex-col gap-2 ${EDITED}` },
			div(
				{ class: "flex flex-wrap items-center gap-1 text-xs" },
				button(
					{
						class: "btn btn-xs",
						title: "Fewer columns",
						disabled: field("atMinColumns"),
						"on:click": send("fewerColumns"),
					},
					"-",
				),
				span({ class: "tabular-nums" }, field("columns"), " columns"),
				button(
					{
						class: "btn btn-xs",
						title: "More columns",
						disabled: field("atMaxColumns"),
						"on:click": send("moreColumns"),
					},
					"+",
				),
				span({ class: "tabular-nums opacity-60" }, field("rows"), " rows"),
			),
			div(
				{ class: "grid gap-2", style: field("gridStyle") },
				editedSlots(""),
				addButton("Add a cell", "justify-self-start"),
			),
		),
	},
	on: {
		...layoutHandlers(),
		moreColumns(next) {
			next.columns = Math.min(this.columns + 1, MAX_COLUMNS);
		},
		fewerColumns(next) {
			next.columns = Math.max(this.columns - 1, 1);
		},
	},
});

// The tabs' headers: each one's label ("Tab n" while its name is empty), the name given (maybe
// empty, so it can be cleared while it's typed) and its class, the active one marked.
const tabHeaders = (self, cls) =>
	self.items.map((_, i) => {
		const name = self.labels[i] ?? "";
		const defaultLabel = `Tab ${i + 1}`;
		const active = i === self.active;
		return {
			name,
			defaultLabel,
			label: name === "" ? defaultLabel : name,
			cls: active ? `tab tab-active ${cls}` : `tab ${cls}`,
			selected: active ? "true" : "false",
		};
	});
const PANEL = `tab-panel grid [:where(&)>*]:w-full [:where(&)>*]:h-full ${BACKED}`;

// Components as tabs, one shown at a time, each with a name ("Tab n" until it's given one);
// edited, tabs are renamed and removed, and the + after the last adds one holding a hole.
export const Tabs = component({
	name: "Tabs",
	fields: {
		items: t.array(t.component()),
		// The tabs' names, by item; a missing or empty one shows as "Tab n".
		labels: t.array(t.string()),
		active: t.number().int().min(0),
	},
	invariants: {
		activeInRange() {
			return this.items.length === 0 || this.active < this.items.length;
		},
	},
	loops: {
		// Only the active tab's panel.
		shown: {
			iter(items) {
				const item = items[this.active];
				return item === undefined ? [] : [[this.active, item]];
			},
		},
	},
	queries: {
		get headers() {
			return tabHeaders(this, "");
		},
		get editedHeaders() {
			return tabHeaders(this, "gap-1");
		},
	},
	view: div(
		{ class: "layout-root tabs-box flex flex-col gap-2" },
		div(
			{ role: "tablist", class: "tabs tabs-border" },
			each(
				field("headers"),
				button(
					{
						role: "tab",
						class: field("cls"),
						"aria-selected": field("selected"),
						"on:click": send("select", sourceKey()),
					},
					field("label"),
				),
			),
		),
		each(field("items"), div({ class: PANEL }, renderIt()), "shown"),
	),
	views: {
		edit: div(
			{ class: `layout-root tabs-box flex flex-col gap-2 ${EDITED}` },
			div(
				{ role: "tablist", class: "tabs tabs-border" },
				each(
					field("editedHeaders"),
					div(
						{
							role: "tab",
							class: field("cls"),
							"aria-selected": field("selected"),
							"on:click": send("select", sourceKey()),
						},
						input({
							class: "tab-name input input-ghost input-xs w-24",
							"aria-label": "Tab name",
							value: field("name"),
							placeholder: field("defaultLabel"),
							"on:input": send("rename", sourceKey(), targetValue()),
						}),
						button(
							{
								class: "tab-remove btn btn-xs btn-circle btn-ghost text-error",
								title: "Remove this tab",
								"on:click": send("removeAt", sourceKey()),
							},
							"×",
						),
					),
				),
				button({ class: "tab-add tab", title: "Add a tab", "on:click": send("add") }, "+"),
			),
			each(field("items"), div({ class: `${PANEL} layout-slot relative` }, renderIt()), "shown"),
		),
	},
	on: {
		...layoutHandlers(),
		// A tab holding a hole after the last, shown.
		add(next, _args, ctx) {
			next.items.push(ctx.scope.components.Hole());
			next.labels = [...this.items.map((_, i) => this.labels[i] ?? ""), ""];
			next.active = this.items.length;
		},
		select: {
			args: [t.index("items")],
			run(next, [at]) {
				next.active = at;
			},
		},
		rename: {
			args: [t.index("items"), t.string()],
			run(next, [at, name]) {
				next.labels = this.items.map((_, i) => (i === at ? name : (this.labels[i] ?? "")));
			},
		},
		// Removing a tab before the active one, or the last while it's active, keeps one shown.
		removeAt: {
			args: [t.index("items")],
			run(next, [at]) {
				next.items.splice(at, 1);
				next.labels = this.items.map((_, i) => this.labels[i] ?? "").filter((_, i) => i !== at);
				const shift = at < this.active ? this.active - 1 : this.active;
				next.active = Math.max(0, Math.min(shift, this.items.length - 2));
			},
		},
	},
});

// The components that are see-through on the canvas: the layouts and the hole.
export const SEE_THROUGH = new Set(["Hole", "VBox", "HBox", "Grid", "Tabs"]);

export const layoutComponents = { Hole, VBox, HBox, Grid, Tabs };
