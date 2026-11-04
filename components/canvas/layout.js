// The canvas's holes and builtin layouts, after tutuca-wax's layout module: components one
// under the other (VBox), side by side (HBox), in a grid (Grid) or as tabs (Tabs), each slot
// starting as a Hole.
// A layout has a main view, the layout as it's used, and an edit view with what edits it: ×
// removes a slot, + adds a hole, and the grid's - and + change its columns. The Item a layout is
// in pushes edit above it while its toggle is on, so every layout below it shows its edit view.
//
// A hole becomes what's picked there, asking the host what that can be: componentKinds lists
// the kinds it can become, and makeComponent makes the one picked, in the hole's scope. It
// notifies become with what's made, which the nearest layout or canvas puts in its place.
// kindHandlers(kinds) answers both for a table of kinds, adding a canvas and the layouts.
//
// A kind is { label, emoji, blurb, make(C, env), width, choices }: make builds the component
// with C, the asker's scope's components, and env { now, tz, uuid, choice }; width is how wide
// an item holding it starts on the canvas (0 keeps the item's); choices, when given, are
// [{ id, title }] to pick one of first, passed to make as env.choice.
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

const { button, div, input, li, p, span, ul } = tag;

// The layouts, as kinds a hole can become.
export const LAYOUT_KINDS = {
	vbox: {
		label: "Vertical box",
		emoji: "⬇️",
		blurb: "Components one under the other.",
		width: 320,
		make: (C) => C.VBox({ items: [C.Hole()] }),
	},
	hbox: {
		label: "Horizontal box",
		emoji: "➡️",
		blurb: "Components side by side.",
		width: 560,
		make: (C) => C.HBox({ items: [C.Hole(), C.Hole()] }),
	},
	grid: {
		label: "Grid",
		emoji: "▦",
		blurb: "Components in rows and columns.",
		width: 560,
		make: (C) => C.Grid({ items: [C.Hole(), C.Hole(), C.Hole(), C.Hole()] }),
	},
	tabs: {
		label: "Tabs",
		emoji: "🗂",
		blurb: "Components as tabs, one shown at a time.",
		width: 480,
		make: (C) => C.Tabs({ items: [C.Hole()], labels: [""] }),
	},
};
// A canvas inside this one, as a kind.
const CANVAS_KIND = {
	label: "Canvas",
	emoji: "🖼️",
	blurb: "A canvas of its own, inside this one.",
	width: 720,
	make: (C) => C.Canvas({ width: 1200, height: 800 }),
};
// kinds, then a canvas and the layouts.
export const withBuiltins = (kinds) => ({ ...kinds, canvas: CANVAS_KIND, ...LAYOUT_KINDS });

// What a kind's make gets besides the components: the clock, ids, and the choice picked.
export const kindEnv = (read, choice = null) => {
	const now = read.now();
	return { now, tz: -new Date(now).getTimezoneOffset(), uuid: () => read.uuid(), choice };
};
// The label of an item holding kind, made with the choice picked of it (or none).
export const kindLabel = (kind, picked = null) => `${kind.emoji} ${picked?.title ?? kind.label}`;

// The ask handlers a hole needs, for a table of kinds and the builtins.
export const kindHandlers = (kinds) => {
	const all = withBuiltins(kinds);
	return {
		// [] → [{ id, label, blurb, choices }]
		componentKinds: () =>
			Object.entries(all).map(([id, kind]) => ({
				id,
				label: kindLabel(kind),
				blurb: kind.blurb ?? "",
				choices: kind.choices ?? [],
			})),
		// [id, choice] → { content, label, width }, made in the asker's scope.
		makeComponent: ([id, choice], read) => {
			const kind = all[id];
			if (kind === undefined) throw new Error(`no component kind ${id}`);
			const picked = kind.choices?.find((c) => c.id === choice) ?? null;
			if (kind.choices !== undefined && picked === null) {
				throw new Error(`${id} needs one of its choices`);
			}
			const content = kind.make(read.scope.components, kindEnv(read, picked?.id ?? null));
			return { content, label: kindLabel(kind, picked), width: kind.width ?? 0 };
		},
	};
};

// What a hole notifies its layout or canvas with: the component, its label and width.
export const BECOME_ARGS = [t.component(), t.string(), t.number().int().min(0)];

const MENU =
	"choices menu menu-sm w-full flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100";
const choiceType = t.record({ id: t.string(), title: t.string() });
const kindType = t.record({
	id: t.string(),
	label: t.string(),
	blurb: t.string(),
	choices: t.array(choiceType),
});
const isKind = (k) =>
	typeof k?.id === "string" &&
	typeof k.label === "string" &&
	Array.isArray(k.choices) &&
	k.choices.every((c) => typeof c?.id === "string" && typeof c.title === "string");

// An empty slot: + asks what it can become and lists it, picking one (and then one of its
// choices, if it has them) asks for it to be made.
export const Hole = component({
	name: "Hole",
	fields: {
		// closed, kind while the kinds are listed, choice while the picked kind's choices are.
		step: t.enum("closed", "kind", "choice").sync("none"),
		// The host's answer to componentKinds, while the menu is open: not part of the layout.
		kinds: t.array(kindType).sync("none"),
		kindId: t.string().sync("none"), // The kind whose choices are listed.
		error: t.string().sync("none"), // Why the last ask failed, empty when it didn't.
	},
	queries: {
		get isClosed() {
			return this.step === "closed";
		},
		get isPickingKind() {
			return this.step === "kind";
		},
		get choiceList() {
			return this.kinds.find((k) => k.id === this.kindId)?.choices ?? [];
		},
		get hasError() {
			return this.error !== "";
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
						{ class: `${MENU} max-h-80` },
						each(
							field("kinds"),
							li(
								button(
									{
										"data-choice": field("id"),
										title: field("blurb"),
										"on:click": send("pick", sourceKey()),
									},
									field("label"),
								),
							),
						),
					),
					ul(
						{ class: `${MENU} max-h-64` },
						each(
							field("choiceList"),
							li(
								button(
									{
										"data-choice": field("id"),
										value: field("id"),
										"on:click": send("pickChoice", targetValue()),
									},
									field("title"),
								),
							),
						),
					),
				),
				$if(field("hasError"), p({ class: "text-center text-xs text-error" }, field("error")), ""),
				button({ class: "btn btn-ghost btn-xs", "on:click": send("close") }, "cancel"),
			),
		),
	),
	on: {
		open: {
			args: [],
			emits: { ask: ["componentKinds"] },
			run(next, _args, ctx) {
				next.error = "";
				ctx.ask("componentKinds");
			},
		},
		close(next) {
			next.step = "closed";
			next.kinds = [];
			next.error = "";
		},
		pick: {
			args: [t.index("kinds")],
			emits: { ask: ["makeComponent"] },
			run(next, [at], ctx) {
				const kind = this.kinds[at];
				if (kind.choices.length > 0) {
					next.step = "choice";
					next.kindId = kind.id;
				} else ctx.ask("makeComponent", [kind.id, null]);
			},
		},
		pickChoice: {
			args: [t.string()],
			emits: { ask: ["makeComponent"] },
			run(_next, [id], ctx) {
				if (this.choiceList.some((c) => c.id === id)) ctx.ask("makeComponent", [this.kindId, id]);
			},
		},
	},
	answers: {
		componentKinds: {
			ok(next, [kinds]) {
				next.kinds = Array.isArray(kinds) ? kinds.filter(isKind) : [];
				next.step = "kind";
				if (next.kinds.length === 0) next.error = "Nothing can go here.";
			},
			error(next, [error]) {
				next.step = "kind";
				next.error = `What can go here couldn't be listed: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.step = "kind";
				next.error = "Nothing can go here: the host lists no component kinds.";
			},
		},
		makeComponent: {
			ok: {
				emits: { notify: ["become"] },
				run(next, [made], ctx) {
					const { content, label, width } = made ?? {};
					if (typeof label !== "string" || !Number.isInteger(width) || content === undefined) {
						next.error = "The host made something that can't go here.";
						return;
					}
					ctx.notify("become", [content, label, width]);
				},
			},
			error(next, [error]) {
				next.error = `It couldn't be made: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.error = "Nothing can be made here: the host makes no components.";
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
		args: BECOME_ARGS,
		sourceKey: t.index("items"),
		run(next, [content], ctx) {
			ctx.stopNext();
			next.items[ctx.sourceKey] = content;
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
