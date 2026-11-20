// The layout component module: boxes, tabs and a grid that hold components, the Hole a slot
// starts as, and the Screen a layout is shown in. Each has a main view, the layout as it's used,
// and a layoutEdit view with what edits it: the +s that add a slot, remove, the tabs' names, the
// grid's rows and columns, and the holes' +. A Screen pushes layoutEdit above its content while
// editing, so every component below it that has that view shows it (a component of any module
// can, by declaring a layoutEdit view) and the rest keep main.
//
// A hole's + asks what it could become: the names of the types visible from the scope the hole
// was made in, which the module's ask handler reads through the asker's context. Picking one
// swaps the hole for a component of that type, made in the hole's scope, or keeps the hole
// saying why when that type can't be made.
//
// A Screen made with studio set (the studio's, which writes components) provides it to what's
// below: the hole's list then offers a new component, and each slot a ✎ that edits the component
// in it, both asks the host answers (createComponent, editComponent). Other hosts leave it unset
// and show neither.
import type { Canvas, Display } from "../meta/meta.tutuca";
import {
	button,
	circle,
	div,
	each,
	field,
	input,
	li,
	lookupBind,
	p,
	path,
	provided,
	pushView,
	render,
	renderIt,
	send,
	sourceKey,
	span,
	svg,
	targetValue,
	ul,
	when,
} from "tutuca/view";
import { get, range } from "tutuca/data";

const DISPLAY = "https://tutuca.dev/meta/display";

// A slot's classes: what's in it fills it, unless it sets its own size; a slot's ✎ and × show
// while it's hovered and no slot inside it is; an edited layout's outline.
const SLOT = "[:where(&)>*]:w-full [:where(&)>*]:h-full";
const HOVER_ONLY =
	"opacity-0 pointer-events-none focus-visible:opacity-100 [.slot:hover:not(:has(.slot:hover))>&]:opacity-100 [.slot:hover:not(:has(.slot:hover))>&]:pointer-events-auto";
const EDIT_BUTTON = `slot-edit btn btn-xs btn-circle btn-ghost absolute -left-1 -top-1 z-10 ${HOVER_ONLY}`;
const REMOVE_BUTTON = `slot-remove btn btn-xs btn-circle btn-ghost absolute -right-1 -top-1 text-error ${HOVER_ONLY}`;
const EDITED = "outline-1 outline-dashed -outline-offset-1 outline-base-content/50 p-2";

/** A display meta's string under key, or "" when it says none. */
function displayText(display: unknown, key: string): string {
	const v = get(display, key);
	return typeof v === "string" ? v : "";
}

/** How a picker shows the type registered as name: its display meta's icon and title
 * ("➡️ Horizontal box"), or its name when it gives no title. */
function displayLabel(display: unknown, name: string): string {
	const title = displayText(display, "title");
	if (title === "") return name;
	const icon = displayText(display, "icon");
	return icon === "" ? title : `${icon} ${title}`;
}

/** labels with an empty name for each panel up to n that has none. */
function labelsFor(labels: readonly string[], n: number): string[] {
	const out = labels.slice();
	for (const _ of range(labels.length, n)) out.push("");
	return out;
}

/** "Tab n", the name of the tab at at that wasn't given one. */
function defaultLabel(at: number): string {
	return `Tab ${at + 1}`;
}

/** What a layout is shown in: its content (a vertical box when it's made with none), and a
 * toggle between using it (main) and editing it (layoutEdit, pushed above the content). */
export type Screen = {
	content: Component | null;
	/** Whether the layout is being edited: a mode, not part of the layout. */
	editing: boolean;
	/** Whether the host makes and edits components (the studio): set when it makes the screen,
	 * never kept. */
	studio: boolean;
	/** The view pushed above the content: layoutEdit while editing. */
	readonly pushed: string;
};
export const Screen = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Screen", icon: "🖥️", description: "A layout, used or edited." },
	},
	defaults: { content: null, editing: false, studio: false },
	sync: { editing: "none", studio: "none" },
	queries: {
		/** While editing, layoutEdit above the content; main, which every component has, otherwise. */
		get pushed(): string {
			return this.editing ? "layoutEdit" : "main";
		},
	},
	init(next, ctx) {
		if (this.content === null) next.content = ctx.make("Vbox");
	},
	on: {
		toggleEditing: {
			pure: true,
			changes: ["editing"],
			post(prev, next, []: []) {
				return next.editing === !prev.editing;
			},
			run(next, []: []) {
				next.editing = !this.editing;
			},
		},
	},
	provides: { studio: "studio" },
	// The toggle is the host's in the studio (its bar has it); others show this one.
	view: div(
		{ class: "screen relative flex flex-col" },
		when(
			field("studio"),
			null,
			button(
				{
					class:
						"screen-toggle btn btn-ghost btn-xs btn-square absolute right-0 top-0 z-10 opacity-30 hover:opacity-100 focus:opacity-100",
					title: when(field("editing"), "Use the layout", "Edit the layout"),
					"aria-label": when(field("editing"), "Use the layout", "Edit the layout"),
					"aria-pressed": when(field("editing"), "true", "false"),
					"on:click": send("toggleEditing"),
				},
				when(
					field("editing"),
					svg(
						{
							viewBox: "0 0 24 24",
							class: "size-4",
							fill: "none",
							stroke: "currentColor",
							"stroke-width": "2",
							"stroke-linecap": "round",
							"stroke-linejoin": "round",
						},
						path({ d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" }),
						circle({ cx: "12", cy: "12", r: "3" }),
					),
					svg(
						{
							viewBox: "0 0 24 24",
							class: "size-4",
							fill: "none",
							stroke: "currentColor",
							"stroke-width": "2",
							"stroke-linecap": "round",
							"stroke-linejoin": "round",
						},
						path({ d: "M12 20h9" }),
						path({ d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" }),
					),
				),
			),
		),
		pushView(field("pushed"), render(field("content"))),
	),
};

/** A type a hole could become, with its display label and description. */
export type Choice = { name: string; label: string; description: string };

/** An empty slot: nothing while the layout is used; while it's edited, + lists the types it
 * could become, and picking one swaps it for a component of that type, made with no fields. A
 * type that can't be made that way keeps the hole, with why in error. */
export type Hole = {
	/** The types listed while + is open; like listing and error, an open menu, not part of a
	 * layout that's kept (sync none). */
	choices: Choice[];
	listing: boolean;
	/** Why the last pick couldn't be made; empty when it could. */
	error: string;
};
export interface HoleAsks {
	/** The type names visible from here; with walk, the parent scopes' too. */
	componentNames(walk: boolean): string[];
	/** A new component, written in the host and registered where the hole can make it: its
	 * name, or "" when it wasn't. */
	createComponent(): string;
}
export const Hole = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Empty", icon: "", description: "An empty slot, to put a component in." },
		"https://tutuca.dev/meta/canvas": { width: 240, transparent: true },
	},
	defaults: { choices: [], listing: false, error: "" },
	sync: { choices: "none", listing: "none", error: "none" },
	on: {
		/** Asks the scope chain, not only the hole's own scope: types registered around it can
		 * go here too. */
		showChoices: {
			changes: ["error"],
			run(next, [], ctx) {
				ctx.ask("componentNames", [true]);
				next.error = "";
			},
		},
		create: {
			changes: ["error"],
			run(next, [], ctx) {
				ctx.ask("createComponent", []);
				next.error = "";
			},
		},
		hideChoices: {
			pure: true,
			changes: ["choices", "listing", "error"],
			post(prev, next, []: []) {
				return !next.listing;
			},
			run(next, []: []) {
				next.choices = [];
				next.listing = false;
				next.error = "";
			},
		},
		/** A component of the type picked, made in the hole's scope with no fields; when it can't
		 * be, the hole stays, saying why, with the choices still up. */
		pick: {
			swap: true,
			changes: ["error"],
			constraints: { at: { keyOf: "choices" } },
			run(next, [at]: [number | null], ctx) {
				const choice = at === null ? undefined : this.choices[at];
				if (choice === undefined) return;
				const made = ctx.tryMake(choice.name);
				if (made.err !== undefined) {
					next.error = made.err.error;
					return;
				}
				return made.ok;
			},
		},
	},
	answers: {
		/** The names, labeled and described by their display meta, without Hole and Screen: a
		 * hole doesn't become a hole, and a screen is what a layout is shown in, not part of it. */
		componentNames: {
			ok(next, [names]: [string[]], ctx) {
				next.choices = names
					.filter((name) => name !== "Hole" && name !== "Screen")
					.map((name) => {
						const display = ctx.metaOf(name, DISPLAY);
						return { name, label: displayLabel(display, name), description: displayText(display, "description") };
					});
				next.listing = true;
			},
		},
		/** The host wrote a new component and registered it; the list, still up, is asked for
		 * again, so it has it. */
		createComponent: {
			ok(next, [name]: [string], ctx) {
				ctx.ask("componentNames", [true]);
			},
			error(next, [error]: [unknown], ctx) {
				next.error = tutuca.errorMessage(error);
			},
		},
	},
	view: div({ class: "hole-empty min-h-4 flex-1" }),
	views: {
		layoutEdit: div(
			{
				class:
					"hole flex min-h-16 min-w-24 flex-1 items-center justify-center outline-1 outline-dashed -outline-offset-1 outline-primary/70 p-2",
			},
			when(
				field("listing"),
				div(
					{ class: "flex flex-col items-center gap-1" },
					ul(
						{ class: "choices menu menu-sm bg-base-100 rounded-box border border-base-300" },
						each(
							field("choices"),
							li({}, button({ title: field("description"), "on:click": send("pick", sourceKey()) }, field("label"))),
						),
						when(
							provided("studio"),
							li({}, button({ class: "hole-new text-primary", "on:click": send("create") }, "+ new component")),
						),
					),
					when(field("error"), p({ class: "error max-w-64 text-center text-xs text-error" }, field("error"))),
					button({ class: "btn btn-xs btn-ghost", "on:click": send("hideChoices") }, "cancel"),
				),
				button(
					{ class: "btn btn-sm btn-circle btn-ghost", title: "Put a component here", "on:click": send("showChoices") },
					"+",
				),
			),
		),
	},
};

/** Components side by side, starting with a hole; edited, each can be removed and the + to
 * their right adds a hole after them. A slot's ✎ and × show while it's hovered and no slot
 * inside it is, so a nested slot's don't cover its parent's. */
export type Hbox = { items: Component[] };
export interface HboxAsks {
	/** The component in a slot, edited in the host. */
	editComponent(item: Component): boolean;
}
export const Hbox = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Horizontal box", icon: "➡️", description: "Components side by side." },
		"https://tutuca.dev/meta/canvas": { width: 560, transparent: true },
	},
	defaults: { items: [] },
	/** With no items, a hole: a box put in a layout has a slot to fill. */
	init(next, ctx) {
		if (this.items.length === 0) next.items = [ctx.make("Hole")];
	},
	on: {
		add: {
			changes: ["items"],
			post(prev, next, []: []) {
				return next.items.length === prev.items.length + 1;
			},
			run(next, [], ctx) {
				next.items.push(ctx.make("Hole"));
			},
		},
		removeAt: {
			pure: true,
			changes: ["items"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null]) {
				next.items = this.items.filter((_, i) => i !== at);
			},
		},
		/** The host edits the component in the slot, and makes the screen again with it. */
		editAt: {
			changes: [],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null], ctx) {
				const item = at === null ? undefined : this.items[at];
				if (item !== undefined) ctx.ask("editComponent", [item]);
			},
		},
	},
	// Each slot a grid in both views: what's in it fills it, as wide as the others and as tall
	// as the tallest; one that sets its own width or height (w-fit, h-fit) keeps it, centered
	// (the full width and height have no specificity, so a component's own classes win).
	view: div(
		{ class: "hbox flex flex-row items-stretch gap-2" },
		each(field("items"), div({ class: `slot grid min-w-0 flex-1 place-items-center ${SLOT}` }, renderIt())),
	),
	views: {
		layoutEdit: div(
			{ class: `hbox flex flex-row items-stretch gap-2 ${EDITED}` },
			each(
				field("items"),
				div(
					{ class: `slot relative grid min-w-0 flex-1 place-items-center ${SLOT}` },
					renderIt(),
					when(
						provided("studio"),
						button({ class: EDIT_BUTTON, title: "Edit this component", "on:click": send("editAt", sourceKey()) }, "✎"),
					),
					button({ class: REMOVE_BUTTON, title: "Remove this slot", "on:click": send("removeAt", sourceKey()) }, "×"),
				),
			),
			button(
				{ class: "slot-add btn btn-xs btn-circle btn-ghost self-center", title: "Add a slot to the right", "on:click": send("add") },
				"+",
			),
		),
	},
};

/** Components one under the other, starting with a hole; edited, each can be removed and the +
 * below them adds a hole there. */
export type Vbox = { items: Component[] };
export interface VboxAsks {
	/** The component in a slot, edited in the host. */
	editComponent(item: Component): boolean;
}
export const Vbox = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Vertical box", icon: "⬇️", description: "Components one under the other." },
		"https://tutuca.dev/meta/canvas": { width: 320, transparent: true },
	},
	defaults: { items: [] },
	/** With no items, a hole. */
	init(next, ctx) {
		if (this.items.length === 0) next.items = [ctx.make("Hole")];
	},
	on: {
		add: {
			changes: ["items"],
			post(prev, next, []: []) {
				return next.items.length === prev.items.length + 1;
			},
			run(next, [], ctx) {
				next.items.push(ctx.make("Hole"));
			},
		},
		removeAt: {
			pure: true,
			changes: ["items"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null]) {
				next.items = this.items.filter((_, i) => i !== at);
			},
		},
		editAt: {
			changes: [],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null], ctx) {
				const item = at === null ? undefined : this.items[at];
				if (item !== undefined) ctx.ask("editComponent", [item]);
			},
		},
	},
	// Each slot a grid in both views: what's in it fills its width, or is centered when it sets
	// its own (as in Hbox).
	view: div(
		{ class: "vbox flex flex-col items-stretch gap-2" },
		each(field("items"), div({ class: `slot grid place-items-center ${SLOT}` }, renderIt())),
	),
	views: {
		layoutEdit: div(
			{ class: `vbox flex flex-col items-stretch gap-2 ${EDITED}` },
			each(
				field("items"),
				div(
					{ class: `slot relative grid place-items-center ${SLOT}` },
					renderIt(),
					when(
						provided("studio"),
						button({ class: EDIT_BUTTON, title: "Edit this component", "on:click": send("editAt", sourceKey()) }, "✎"),
					),
					button({ class: REMOVE_BUTTON, title: "Remove this slot", "on:click": send("removeAt", sourceKey()) }, "×"),
				),
			),
			button(
				{ class: "slot-add btn btn-xs btn-circle btn-ghost self-center", title: "Add a slot below", "on:click": send("add") },
				"+",
			),
		),
	},
};

/** Components as tabs, one shown at a time, each with a name ("Tab n" until it's given one),
 * starting with one holding a hole; edited, tabs are renamed and removed, and the + after the
 * last adds one holding a hole. */
export type Tabs = {
	panels: Component[];
	/** The tabs' names, by panel; a missing or empty one shows as "Tab n". */
	labels: string[];
	active: number;
};
export interface TabsAsks {
	/** The component in a tab, edited in the host. */
	editComponent(item: Component): boolean;
}
export const Tabs = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Tabs", icon: "🗂", description: "Components as tabs, one shown at a time." },
		"https://tutuca.dev/meta/canvas": { width: 480, transparent: true },
	},
	defaults: { panels: [], labels: [], active: 0 },
	constraints: { active: { int: true, min: 0 } },
	/** With no panels, one holding a hole, unnamed, and shown. */
	init(next, ctx) {
		if (this.panels.length !== 0) return;
		next.panels = [ctx.make("Hole")];
		next.labels = labelsFor(this.labels, 1);
		next.active = 0;
	},
	invariants: {
		activeInRange(): boolean {
			return this.panels.length === 0 || this.active < this.panels.length;
		},
	},
	on: {
		/** The new tab is the one shown, named "Tab n" until it's renamed. */
		add: {
			changes: ["panels", "labels", "active"],
			post(prev, next, []: []) {
				return next.panels.length === prev.panels.length + 1;
			},
			run(next, [], ctx) {
				next.panels.push(ctx.make("Hole"));
				next.labels = labelsFor(this.labels, this.panels.length + 1);
				next.active = this.panels.length;
			},
		},
		select: {
			pure: true,
			changes: ["active"],
			constraints: { at: { keyOf: "panels" } },
			run(next, [at]: [number | null]) {
				if (at !== null) next.active = at;
			},
		},
		editAt: {
			changes: [],
			constraints: { at: { keyOf: "panels" } },
			run(next, [at]: [number | null], ctx) {
				const item = at === null ? undefined : this.panels[at];
				if (item !== undefined) ctx.ask("editComponent", [item]);
			},
		},
		rename: {
			pure: true,
			changes: ["labels"],
			constraints: { at: { keyOf: "panels" } },
			run(next, [at, label]: [number | null, string]) {
				if (at === null) return;
				next.labels = labelsFor(this.labels, this.panels.length);
				next.labels[at] = label;
			},
		},
		/** A name left empty becomes "Tab n". */
		finishRename: {
			pure: true,
			changes: ["labels"],
			constraints: { at: { keyOf: "panels" } },
			run(next, [at]: [number | null]) {
				if (at === null || (this.labels[at] ?? "") !== "") return;
				next.labels = labelsFor(this.labels, this.panels.length);
				next.labels[at] = defaultLabel(at);
			},
		},
		/** The tab shown stays the one shown, or the one before the removed one when it was the
		 * last. */
		removeAt: {
			pure: true,
			changes: ["panels", "labels", "active"],
			constraints: { at: { keyOf: "panels" } },
			post(prev, next, [at]: [number | null]) {
				return at === null || next.panels.length === prev.panels.length - 1;
			},
			run(next, [at]: [number | null]) {
				if (at === null) return;
				const panels = this.panels.filter((_, i) => i !== at);
				next.panels = panels;
				next.labels = labelsFor(this.labels, this.panels.length).filter((_, i) => i !== at);
				let active = this.active;
				if (at < active || active >= panels.length) active = active - 1;
				next.active = active < 0 ? 0 : active;
			},
		},
	},
	loops: {
		/** The tab headers: each one's name, the active one marked; name is the one given, maybe
		 * empty, so it can be cleared while it's typed. */
		headers: {
			enrich(key: number, panel: Component) {
				const name = this.labels[key] ?? "";
				const fallback = defaultLabel(key);
				return { label: name === "" ? fallback : name, name, defaultLabel: fallback, isActive: key === this.active };
			},
		},
		/** The panels: only the active one. */
		shown: {
			filter(key: number, panel: Component): boolean {
				return key === this.active;
			},
		},
	},
	view: div(
		{ class: "tabs-box flex flex-col gap-2" },
		div(
			{ role: "tablist", class: "tabs tabs-border" },
			each(
				field("panels"),
				button(
					{ role: "tab", class: when(lookupBind("isActive"), "tab tab-active", "tab"), "on:click": send("select", sourceKey()) },
					lookupBind("label"),
				),
				"headers",
			),
		),
		each(field("panels"), div({ class: `tab-panel grid place-items-center ${SLOT}` }, renderIt()), "shown"),
	),
	views: {
		layoutEdit: div(
			{ class: `tabs-box flex flex-col gap-2 ${EDITED}` },
			div(
				{ role: "tablist", class: "tabs tabs-border" },
				each(
					field("panels"),
					div(
						{
							role: "tab",
							class: when(lookupBind("isActive"), "tab tab-active gap-1", "tab gap-1"),
							"on:click": send("select", sourceKey()),
						},
						input({
							class: "tab-name input input-ghost input-xs w-24",
							"aria-label": "Tab name",
							value: lookupBind("name"),
							placeholder: lookupBind("defaultLabel"),
							"on:input": send("rename", sourceKey(), targetValue()),
							"on:change": send("finishRename", sourceKey()),
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
					"headers",
				),
				button({ class: "tab-add tab", title: "Add a tab", "on:click": send("add") }, "+"),
			),
			// A slot, so hovering what it holds shows its ✎, not the one of the slot the tabs are in.
			each(
				field("panels"),
				div(
					{ class: `tab-panel slot relative grid place-items-center ${SLOT}` },
					renderIt(),
					when(
						provided("studio"),
						button({ class: EDIT_BUTTON, title: "Edit this component", "on:click": send("editAt", sourceKey()) }, "✎"),
					),
				),
				"shown",
			),
		),
	},
	examples: {
		addThenSelect: {
			start: {},
			steps: [{ send: "add" }, { expect: { active: 1 } }, { send: "select", args: [0] }, { expect: { active: 0 } }],
		},
		removeKeepsATabShown: {
			start: {},
			steps: [{ send: "add" }, { send: "removeAt", args: [1] }, { expect: { active: 0, labels: [""] } }],
		},
	},
};

/** Components in a grid, starting with a hole; edited, cells are removed, the + after the last
 * adds one, and the columns and rows grow and shrink with - and +. */
export type Grid = {
	cells: Component[];
	columns: number;
	readonly gridStyle: string;
	/** Rows, the last one maybe not full. */
	readonly rows: number;
};
export interface GridAsks {
	/** The component in a cell, edited in the host. */
	editComponent(item: Component): boolean;
}
export const Grid = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Grid", icon: "▦", description: "Components in rows and columns." },
		"https://tutuca.dev/meta/canvas": { width: 560, transparent: true },
	},
	defaults: { cells: [], columns: 2 },
	constraints: { columns: { int: true, min: 1, max: 6 } },
	/** With no cells, a hole. */
	init(next, ctx) {
		if (this.cells.length === 0) next.cells = [ctx.make("Hole")];
	},
	queries: {
		get gridStyle(): string {
			return `grid-template-columns: repeat(${this.columns}, minmax(0, 1fr))`;
		},
		get rows(): number {
			return Math.ceil(this.cells.length / this.columns);
		},
	},
	on: {
		add: {
			changes: ["cells"],
			post(prev, next, []: []) {
				return next.cells.length === prev.cells.length + 1;
			},
			run(next, [], ctx) {
				next.cells.push(ctx.make("Hole"));
			},
		},
		removeAt: {
			pure: true,
			changes: ["cells"],
			constraints: { at: { keyOf: "cells" } },
			run(next, [at]: [number | null]) {
				next.cells = this.cells.filter((_, i) => i !== at);
			},
		},
		editAt: {
			changes: [],
			constraints: { at: { keyOf: "cells" } },
			run(next, [at]: [number | null], ctx) {
				const item = at === null ? undefined : this.cells[at];
				if (item !== undefined) ctx.ask("editComponent", [item]);
			},
		},
		// pre is only checked in dev mode, the handlers run regardless: columns stays in 1..6.
		moreColumns: {
			pure: true,
			changes: ["columns"],
			pre(prev, []: []) {
				return this.columns < 6;
			},
			post(prev, next, []: []) {
				return next.columns === prev.columns + 1;
			},
			run(next, []: []) {
				next.columns = Math.min(this.columns + 1, 6);
			},
		},
		fewerColumns: {
			pure: true,
			changes: ["columns"],
			pre(prev, []: []) {
				return this.columns > 1;
			},
			post(prev, next, []: []) {
				return next.columns === prev.columns - 1;
			},
			run(next, []: []) {
				next.columns = Math.max(this.columns - 1, 1);
			},
		},
		/** A row of holes below the others. */
		addRow: {
			changes: ["cells"],
			post(prev, next, []: []) {
				return next.cells.length === prev.cells.length + prev.columns;
			},
			run(next, [], ctx) {
				for (const _ of range(0, this.columns)) next.cells.push(ctx.make("Hole"));
			},
		},
		/** The last row's cells, removed: the cells past the last full row, or a full row. */
		removeRow: {
			pure: true,
			changes: ["cells"],
			pre(prev, []: []) {
				return this.cells.length > 0;
			},
			post(prev, next, []: []) {
				return next.cells.length < prev.cells.length;
			},
			run(next, []: []) {
				const n = this.cells.length;
				if (n === 0) return;
				const partial = n % this.columns;
				next.cells = this.cells.slice(0, n - (partial === 0 ? this.columns : partial));
			},
		},
	},
	view: div(
		{ class: "grid-box grid gap-2", style: field("gridStyle") },
		each(field("cells"), div({ class: `slot grid min-w-0 place-items-center ${SLOT}` }, renderIt())),
	),
	views: {
		layoutEdit: div(
			{ class: `grid-box flex flex-col gap-2 ${EDITED}` },
			div(
				{ class: "flex flex-wrap items-center gap-1 text-xs" },
				button({ class: "btn btn-xs", title: "Fewer columns", "on:click": send("fewerColumns") }, "-"),
				span({ class: "tabular-nums" }, field("columns"), " columns"),
				button({ class: "btn btn-xs", title: "More columns", "on:click": send("moreColumns") }, "+"),
				button({ class: "btn btn-xs", title: "Remove the last row", "on:click": send("removeRow") }, "-"),
				span({ class: "tabular-nums" }, field("rows"), " rows"),
				button({ class: "btn btn-xs", title: "Add a row", "on:click": send("addRow") }, "+"),
			),
			div(
				{ class: "grid gap-2", style: field("gridStyle") },
				each(
					field("cells"),
					div(
						{ class: `slot relative grid place-items-center ${SLOT}` },
						renderIt(),
						when(
							provided("studio"),
							button({ class: EDIT_BUTTON, title: "Edit this component", "on:click": send("editAt", sourceKey()) }, "✎"),
						),
						button({ class: REMOVE_BUTTON, title: "Remove this cell", "on:click": send("removeAt", sourceKey()) }, "×"),
					),
				),
				button(
					{
						class: "slot-add btn btn-xs btn-circle btn-ghost self-center justify-self-start",
						title: "Add a cell",
						"on:click": send("add"),
					},
					"+",
				),
			),
		),
	},
	examples: {
		rowsFollowTheColumns: {
			start: { columns: 3 },
			steps: [{ send: "addRow" }, { expect: { rows: 2 } }, { send: "removeRow" }, { expect: { rows: 1 } }],
		},
		columnsStayInRange: {
			start: { columns: 6 },
			steps: [{ send: "fewerColumns" }, { expect: { columns: 5 } }],
		},
	},
};

export const register = { Screen: "Screen", Hole: "Hole", Hbox: "Hbox", Vbox: "Vbox", Tabs: "Tabs", Grid: "Grid" };

/** componentNames: the type names the asker's scope can make. */
export const askHandlers = {
	componentNames(walk: boolean, ctx: AskCtx): string[] {
		return ctx.componentNames(walk);
	},
};
/** createComponent and editComponent: answered by the studio, later. */
export const hostAsks = ["createComponent", "editComponent"];
