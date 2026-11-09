// Views of data that any app can use: JsonView shows JSON (or any text) as a tree or as raw
// text, with a copy button (it asks copyText); DataTable previews rows of objects with a pager;
// List holds component items to drag, page, add and remove; the pager's fields, queries,
// handlers and view for any component that pages a list; and defineAttrElement for custom
// elements that draw from one attribute.

import { CLASSES_META } from "../../src/meta/index.js";
import {
	$if,
	apply,
	button,
	component,
	dragKey,
	each,
	field,
	lookupBind,
	renderIt,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { setField } from "../common/card.js";
import { segmented } from "../common/ui.js";
import { isModKey, mix } from "../common/util.js";
import { indent, nodes, parse } from "./json.js";
import { columnsOf, previewRows } from "./table.js";

const { div, option, p, pre, select, span, table, tbody, td, textarea, th, thead, tr } = tag;

const TYPE_CLASS = {
	string: "text-success",
	number: "text-info",
	boolean: "text-warning",
	null: "opacity-60",
	array: "opacity-60",
	object: "opacity-60",
};

// JSON text (or any text: when it isn't JSON, only the raw view is offered) as a tree or raw,
// with a copy button. Editable ones edit the raw text and notify `on` with [id, text], so the
// component that owns the data keeps it.
export const JsonView = component({
	name: "JsonView",
	// The cls of its tree's nodes.
	meta: { [CLASSES_META]: { classes: Object.values(TYPE_CLASS).join(" ") } },
	fields: {
		id: t.string(),
		label: t.string(),
		text: t.string(),
		mode: t.enum("tree", "raw"),
		editable: t.boolean(),
		json: t.boolean(true), // false: plain text (no tree, no JSON errors), still with Copy.
		on: t.string("json_edited"),
		rows: t.number(10).int().min(1),
		collapsed: t.array(t.string()), // The pointers of the folded nodes.
		copied: t.boolean(),
	},
	queries: {
		get parsed() {
			return parse(this.text);
		},
		get isJson() {
			return this.json && this.parsed.error === "";
		},
		get error() {
			return this.json && this.editable && this.text.trim() !== "" ? this.parsed.error : "";
		},
		get hasError() {
			return this.error !== "";
		},
		get showTree() {
			return this.mode === "tree" && this.isJson;
		},
		get showRawEditor() {
			return !this.showTree && this.editable;
		},
		get showRawText() {
			return !this.showTree && !this.editable;
		},
		get hasLabel() {
			return this.label !== "";
		},
		get showRaw() {
			return !this.showTree;
		},
		get copyLabel() {
			return this.copied ? "Copied" : "Copy";
		},
		// The tree's rows, without what folded nodes hide.
		get treeRows() {
			if (!this.isJson) return [];
			const folded = this.collapsed;
			const hidden = (pointer) => folded.some((f) => pointer !== f && pointer.startsWith(`${f}/`));
			return nodes(this.parsed.value, { rootKey: "$" })
				.filter((n) => !hidden(n.pointer))
				.map((n) => {
					const container = n.type === "array" || n.type === "object";
					const isFolded = folded.includes(n.pointer);
					return {
						pointer: n.pointer,
						key: n.key,
						text: n.text,
						style: indent(n.depth, 1),
						toggle: container ? (isFolded ? "▸" : "▾") : " ",
						cls: TYPE_CLASS[n.type] ?? "",
					};
				});
		},
	},
	view: div(
		{ class: "flex min-w-0 flex-col gap-1" },
		div(
			{ class: "flex items-center gap-2" },
			$if(
				field("hasLabel"),
				span({ class: "text-xs font-semibold uppercase opacity-60" }, field("label")),
				"",
			),
			span({ class: "flex-1" }),
			$if(
				field("isJson"),
				segmented(
					"Show",
					"show",
					[
						["tree", "Tree", "showTree"],
						["raw", "Raw", "showRaw"],
					],
					{ active: "btn-active" },
				),
				"",
			),
			button(
				{ class: "btn btn-xs btn-ghost", title: "Copy to the clipboard", "on:click": send("copy") },
				field("copyLabel"),
			),
		),
		$if(
			field("showTree"),
			div(
				{ class: "max-h-96 overflow-auto rounded bg-base-200 p-2 font-mono text-xs" },
				each(
					field("treeRows"),
					div(
						{
							class: "flex cursor-default gap-1 whitespace-nowrap hover:bg-base-300",
							style: field("style"),
							"on:click": send("fold", sourceKey()),
						},
						span({ class: "w-3 opacity-60" }, field("toggle")),
						span({ class: "font-semibold" }, field("key")),
						span({ class: "opacity-60" }, ":"),
						span({ class: field("cls") }, field("text")),
					),
				),
			),
			"",
		),
		$if(
			field("showRawEditor"),
			textarea({
				class: "textarea textarea-bordered max-h-96 w-full font-mono text-xs",
				rows: field("rows"),
				spellcheck: "false",
				"aria-label": field("label"),
				value: field("text"),
				"on:input": send("edit", targetValue()),
			}),
			"",
		),
		$if(
			field("showRawText"),
			pre(
				{
					class:
						"max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-base-200 p-2 font-mono text-xs",
				},
				field("text"),
			),
			"",
		),
		$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
	),
	on: {
		// What its holder may change: the text it shows, and its label.
		set_text: setField("text", t.string(), { pure: true }),
		set_label: setField("label", t.string(), { pure: true }),
		show: setField("mode", t.enum("tree", "raw"), { pure: true }),
		// A click on a tree row folds or unfolds it; with Ctrl (Cmd on a Mac) its siblings that
		// have children do the same.
		fold: {
			args: [t.number().int().min(0)],
			run(next, [i], ctx) {
				const row = this.treeRows[i];
				if (row === undefined || row.toggle === " ") return;
				const folding = !this.collapsed.includes(row.pointer);
				const all = isModKey(ctx.event);
				const parent = row.pointer.slice(0, row.pointer.lastIndexOf("/"));
				const targets = all
					? nodes(this.parsed.value, { rootKey: "$" })
							.filter((n) => (n.type === "array" || n.type === "object") && n.pointer !== "")
							.filter((n) => n.pointer.slice(0, n.pointer.lastIndexOf("/")) === parent)
							.map((n) => n.pointer)
					: [row.pointer];
				if (row.pointer === "") targets.splice(0, targets.length, "");
				const kept = this.collapsed.filter((p) => !targets.includes(p));
				next.collapsed = folding ? [...kept, ...targets] : kept;
			},
		},
		edit: {
			args: [t.string()],
			run(next, [text], ctx) {
				next.text = text;
				ctx.notify(this.on, [this.id, text]);
			},
		},
		copy: {
			args: [],
			emits: { ask: ["copyText"] },
			run(_next, _args, ctx) {
				ctx.ask("copyText", [this.text]);
			},
		},
	},
	answers: {
		copyText: {
			ok(next) {
				next.copied = true;
			},
			error(next) {
				next.copied = false;
			},
			unhandled() {},
		},
	},
});

// JSON text for a value, for a JsonView; a string is taken as the text itself (use pretty for a
// JSON string value).
export const jsonText = (value) =>
	typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "null");
// The args of a JsonView of value (a value, or text as it is). It opens as a tree (text that
// isn't JSON shows raw); editable ones edit in the raw view and notify on with [id, text].
export const jsonViewArgs = (
	value,
	{ label = "", mode, id = "", editable = false, json = true, on, rows } = {},
) => ({
	id,
	label,
	text: jsonText(value),
	mode: mode ?? (json ? "tree" : "raw"),
	editable,
	json,
	...(on === undefined ? {} : { on }),
	...(rows === undefined ? {} : { rows }),
});

// --- pagination ------------------------------------------------------------------------------------

export const PAGE_SIZES = [5, 10, 25, 50, 100];
// A pager's names: its fields and getters are prefixed in camelCase ("" → page, "texts" →
// textsPage), its handlers in snake_case ("" → page_next, "texts" → texts_page_next).
const pagerNames = (prefix = "") => {
	const n = (name) => (prefix === "" ? name : `${prefix}${name[0].toUpperCase()}${name.slice(1)}`);
	const h = (name) => (prefix === "" ? name : `${prefix}_${name}`);
	return {
		page: n("page"),
		pageSize: n("pageSize"),
		open: n("pagerOpen"),
		total: n("pagerTotal"),
		count: n("pageCount"),
		now: n("pageNow"),
		rows: n("pagedRows"),
		label: n("pagerLabel"),
		noPrev: n("noPrev"),
		noNext: n("noNext"),
		has: n("hasPager"),
		sizes: n("pageSizes"),
		sizeText: n("pageSizeText"),
		first: h("page_first"),
		prev: h("page_prev"),
		next: h("page_next"),
		last: h("page_last"),
		toggle: h("toggle_pager"),
		setSize: h("set_page_size"),
	};
};
// A pager's fields (spread them into a component's): the page (from 0), the page size and
// whether its settings (⚙) are open.
export const pagerFields = (prefix = "") => {
	const N = pagerNames(prefix);
	return {
		[N.page]: t.number(0).int().min(0),
		[N.pageSize]: t.number(10).int().min(1),
		[N.open]: t.boolean(),
	};
};
// A pager's queries over the rows a getter (or field) named rowsGetter gives: pagedRows (the
// page's rows), pagerLabel ("11–20 of 120"), pageCount, pageNow, noPrev, noNext, hasPager (more
// rows than fit in a page: only then the bar shows) and pageSizes (for the ⚙ select).
export const pagerQueries = (rowsGetter, prefix = "") => {
	const N = pagerNames(prefix);
	return Object.defineProperties(
		{},
		{
			[N.total]: {
				get() {
					return this[rowsGetter].length;
				},
				enumerable: true,
				configurable: true,
			},
			[N.count]: {
				get() {
					return Math.max(1, Math.ceil(this[N.total] / this[N.pageSize]));
				},
				enumerable: true,
				configurable: true,
			},
			[N.now]: {
				get() {
					return Math.min(this[N.page], this[N.count] - 1);
				},
				enumerable: true,
				configurable: true,
			},
			[N.rows]: {
				get() {
					const start = this[N.now] * this[N.pageSize];
					return this[rowsGetter].slice(start, start + this[N.pageSize]);
				},
				enumerable: true,
				configurable: true,
			},
			[N.label]: {
				get() {
					const total = this[N.total];
					if (total === 0) return "nothing";
					const start = this[N.now] * this[N.pageSize];
					return `${start + 1}–${Math.min(start + this[N.pageSize], total)} of ${total}`;
				},
				enumerable: true,
				configurable: true,
			},
			[N.noPrev]: {
				get() {
					return this[N.now] === 0;
				},
				enumerable: true,
				configurable: true,
			},
			[N.noNext]: {
				get() {
					return this[N.now] >= this[N.count] - 1;
				},
				enumerable: true,
				configurable: true,
			},
			[N.has]: {
				get() {
					return this[N.total] > this[N.pageSize];
				},
				enumerable: true,
				configurable: true,
			},
			[N.sizes]: {
				get() {
					return PAGE_SIZES.map((v) => ({ value: String(v), label: `${v} per page` }));
				},
				enumerable: true,
				configurable: true,
			},
			[N.sizeText]: {
				get() {
					return String(this[N.pageSize]);
				},
				enumerable: true,
				configurable: true,
			},
		},
	);
};
// The pager's handlers (spread them into the component's on).
export const pagerHandlers = (prefix = "") => {
	const N = pagerNames(prefix);
	return {
		[N.first]: {
			args: [],
			run(next) {
				next[N.page] = 0;
			},
		},
		[N.prev]: {
			args: [],
			run(next) {
				next[N.page] = Math.max(0, this[N.now] - 1);
			},
		},
		[N.next]: {
			args: [],
			run(next) {
				next[N.page] = Math.min(this[N.count] - 1, this[N.now] + 1);
			},
		},
		[N.last]: {
			args: [],
			run(next) {
				next[N.page] = this[N.count] - 1;
			},
		},
		[N.toggle]: {
			args: [],
			run(next) {
				next[N.open] = !this[N.open];
			},
		},
		// Keeps the first row on the page shown.
		[N.setSize]: {
			args: [t.string()],
			run(next, [text]) {
				const size = Number(text);
				if (!Number.isInteger(size) || size < 1) return;
				const first = this[N.now] * this[N.pageSize];
				next[N.pageSize] = size;
				next[N.page] = Math.floor(first / size);
			},
		},
	};
};
// The pager bar: first, previous, the rows shown, next, last, and ⚙ for the page size. It shows
// only when there are more rows than fit in a page. Put it over the table or list, so it stays
// put when a page has fewer rows.
export const pagerView = (prefix = "") => {
	const N = pagerNames(prefix);
	return $if(
		field(N.has),
		div(
			{ class: "flex flex-wrap items-center gap-1 text-xs" },
			div(
				{ class: "join" },
				button(
					{
						class: "btn btn-xs join-item",
						title: "First page",
						disabled: field(N.noPrev),
						"on:click": send(N.first),
					},
					"«",
				),
				button(
					{
						class: "btn btn-xs join-item",
						title: "Previous page",
						disabled: field(N.noPrev),
						"on:click": send(N.prev),
					},
					"‹",
				),
				button(
					{
						class: "btn btn-xs join-item",
						title: "Next page",
						disabled: field(N.noNext),
						"on:click": send(N.next),
					},
					"›",
				),
				button(
					{
						class: "btn btn-xs join-item",
						title: "Last page",
						disabled: field(N.noNext),
						"on:click": send(N.last),
					},
					"»",
				),
			),
			span({ class: "px-2 opacity-70" }, field(N.label)),
			span({ class: "flex-1" }),
			$if(
				field(N.open),
				select(
					{
						class: "select select-xs select-bordered w-32",
						"aria-label": "Rows per page",
						value: field(N.sizeText),
						"on:change": send(N.setSize, targetValue()),
					},
					each(field(N.sizes), option({ value: field("value") }, field("label"))),
				),
				"",
			),
			button(
				{
					class: "btn btn-ghost btn-xs btn-circle",
					title: "Rows per page",
					"on:click": send(N.toggle),
				},
				"⚙",
			),
		),
		"",
	);
};

// A table's first rows, with each column's name and type.
export const DataTable = component({
	name: "DataTable",
	fields: {
		id: t.string(),
		kind: t.enum("table", "csv"),
		rows: t.array(t.any()),
		delimiter: t.string(","),
		edited: t.boolean(), // Changed since it was opened, so encode writes it back.
		...pagerFields(),
	},
	queries: mix(pagerQueries("rows"), {
		get columns() {
			return columnsOf(this.rows);
		},
		get label() {
			return `${this.kind} · ${this.rows.length} rows`;
		},
		get previewRows() {
			return previewRows(this.pagedRows, this.columns, this.pageSize);
		},
	}),
	view: div(
		{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-2" },
		div(
			{ class: "flex items-center gap-2" },
			span({ class: "font-mono font-semibold" }, field("id")),
			span({ class: "badge badge-ghost badge-sm" }, field("label")),
		),
		pagerView(),
		div(
			{ class: "max-h-96 overflow-auto" },
			table(
				{ class: "table table-xs table-pin-rows" },
				thead(
					tr(
						each(
							field("columns"),
							th(span(field("name")), " ", span({ class: "opacity-50" }, field("type"))),
						),
					),
				),
				tbody(each(field("previewRows"), tr(each(field("cells"), td(field("text")))))),
			),
		),
	),
	on: {
		...pagerHandlers(),
		// New rows from its holder: an edit, so encode writes them back.
		set_rows: {
			pure: true,
			args: [t.array(t.any())],
			run(next, [rows]) {
				next.rows = rows;
				next.edited = true;
			},
		},
	},
});

// A custom element that draws from one attribute: draw(el, value) when it changes (and on
// connect), dispose(el) when it leaves the page. Does nothing without customElements (Node).
export const defineAttrElement = (name, attr, { draw, dispose = () => {} }) => {
	const ce = globalThis.customElements;
	if (ce === undefined || ce.get(name) !== undefined) return;
	ce.define(
		name,
		class extends globalThis.HTMLElement {
			static observedAttributes = [attr];
			connectedCallback() {
				this.update();
			}
			attributeChangedCallback() {
				this.update();
			}
			disconnectedCallback() {
				dispose(this);
				this.drawn = null;
			}
			update() {
				const value = this.getAttribute(attr);
				if (!this.isConnected || value === null || value === this.drawn) return;
				this.drawn = value;
				draw(this, value);
			}
		},
	);
};

// --- lists ------------------------------------------------------------------------------------------

// Whether a drop landed on the lower half of the element that handles it (none in tests: above).
const isLowerHalf = ({ event, node }) => {
	if (node === null || node === undefined || typeof event?.clientY !== "number") return false;
	const rect = node.getBoundingClientRect();
	return event.clientY > rect.top + rect.height / 2;
};

// A list of component items: each one with a drag handle (drag it onto another item to move it
// above or below it), its own view and a remove button; a pager over it when there are more
// items than fit in a page; and an add button when it has an addLabel. It changes nothing
// itself: it notifies the component holding it, whose handlers (listHandlers(name, …)) change
// the items, so a tool and the page take one path. name is the field it is in. Make one with
// listOf(C, name, items, { addLabel }).
export const List = component({
	name: "List",
	fields: {
		name: t.string(),
		items: t.array(t.component()),
		addLabel: t.string(),
		removeTitle: t.string("Remove"),
		...pagerFields(),
	},
	queries: mix(pagerQueries("items"), {
		get hasAdd() {
			return this.addLabel !== "";
		},
		get addText() {
			return `+ ${this.addLabel}`;
		},
	}),
	loops: {
		// Only the page's items; they keep their indexes, so drag and remove find them.
		items: {
			filter(key) {
				const start = this.pageNow * this.pageSize;
				return key >= start && key < start + this.pageSize;
			},
			enrich() {
				return { dragType: this.name, removeTitle: this.removeTitle };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-2" },
		pagerView(),
		each(
			field("items"),
			div(
				{
					class:
						"flex items-center gap-2 rounded-box data-[draggingover]:bg-primary/10 data-[draggingover]:ring-1 data-[draggingover]:ring-primary",
					"on:drop": send("drop", dragKey(), sourceKey()),
				},
				span(
					{
						class: "cursor-grab select-none px-1 opacity-40 hover:opacity-100",
						draggable: "true",
						"data-dragtype": lookupBind("dragType"),
						title: "Drag to reorder",
					},
					"⠿",
				),
				div({ class: "min-w-0 flex-1" }, renderIt()),
				button(
					{
						class: "btn btn-ghost btn-circle btn-xs text-error hover:bg-error/10",
						title: lookupBind("removeTitle"),
						"on:click": send("remove", sourceKey()),
					},
					"✕",
				),
			),
			"items",
		),
		$if(
			field("hasAdd"),
			button({ class: "btn btn-sm self-start", "on:click": send("add") }, field("addText")),
			"",
		),
	),
	on: {
		...pagerHandlers(),
		// What its holder (listHandlers) changes: the items and their order, through these.
		move_item: {
			pure: true,
			args: [t.number().int().min(0), t.number().int().min(0)],
			run(next, [from, to]) {
				if (from >= this.items.length || from === to) return;
				const [item] = next.items.splice(from, 1);
				next.items.splice(Math.min(to, next.items.length), 0, item);
			},
		},
		remove_item_at: {
			pure: true,
			args: [t.number().int().min(0)],
			pre: (self, [i]) => i < self.items.length,
			run(next, [i]) {
				next.items.splice(i, 1);
			},
		},
		add_item: {
			pure: true,
			args: [t.component()],
			run(next, [item]) {
				next.items.push(item);
			},
		},
		// The page of the last item: where the add button's new item is.
		show_last_page: {
			pure: true,
			run(next) {
				next.page = Math.max(0, Math.ceil(this.items.length / this.pageSize) - 1);
			},
		},
		// An item of this list dropped on item onto: above it, or below on its lower half.
		drop: {
			args: [t.option(t.index("items")), t.index("items")],
			run(_next, [from, onto], ctx) {
				if (from === null || from === onto || ctx.drag?.type !== this.name) return;
				let to = isLowerHalf(ctx) ? onto + 1 : onto;
				if (from < to) to--;
				if (to !== from) ctx.notify(`move_${this.name}`, [from, to]);
			},
		},
		remove: {
			args: [t.index("items")],
			run(_next, [i], ctx) {
				ctx.notify(`remove_${this.name}_at`, [i]);
			},
		},
		add: {
			args: [],
			run(_next, _args, ctx) {
				ctx.notify(`add_${this.name}`);
			},
		},
	},
});

// A List for the field name, with items (and, with addLabel, an add button).
export const listOf = (C, name, items, { addLabel = "", removeTitle = "Remove" } = {}) =>
	C.List({ name, items, addLabel, removeTitle });

// The handlers of the component holding the List in its field name (spread them into its on);
// the List notifies them, and tools and tests can send them too:
//   move_<name>(from, to)      moves the item at from to to (a drag)
//   remove_<name>_at(index)    the remove button
//   add_<name>()               the add button, when make gives the new item; shows its page
//   reorder_<name>(id, index)  moves the item with id to index: a tool for the model
// make(self, ctx, next) gives the new item (and may change next too); removed(self, next, item,
// ctx) runs after a removal (to drop what refers to it); changed(self, next) after any
// change to the items or their order (to refresh what derives from them); id(item) is
// the item's id (item.id).
export const listHandlers = (
	name,
	{ make = null, removed = null, changed = null, id = (x) => x.id } = {},
) => {
	const items = (x) => x[name].items;
	const handlers = {
		[`move_${name}`]: {
			args: [t.number().int().min(0), t.number().int().min(0)],
			run(next, [from, to], ctx) {
				ctx.stopNext();
				next[name] = apply(next[name], "move_item", from, to);
			},
		},
		[`remove_${name}_at`]: {
			args: [t.number().int().min(0)],
			pre: (self, [i]) => i < items(self).length,
			run(next, [i], ctx) {
				ctx.stopNext();
				const item = items(this)[i];
				next[name] = apply(next[name], "remove_item_at", i);
				removed?.(this, next, item, ctx);
			},
		},
		[`reorder_${name}`]: {
			pure: true,
			args: [t.string(), t.number().int().min(0)],
			pre: (self, [key]) => items(self).some((x) => id(x) === key),
			run(next, [key, index]) {
				const from = items(this).findIndex((x) => id(x) === key);
				next[name] = apply(next[name], "move_item", from, index);
			},
		},
	};
	if (make !== null) {
		handlers[`add_${name}`] = {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				const list = apply(next[name], "add_item", make(this, ctx, next));
				next[name] = apply(list, "show_last_page");
			},
		};
	}
	if (changed !== null) {
		// changed(self, next) gets no ctx, so a pure handler stays pure.
		for (const h of Object.values(handlers)) {
			const run = h.run;
			const after = (self, next, before, order) => {
				if (items(next).length !== before || items(next).map(id).join("\u0000") !== order) {
					changed(self, next);
				}
			};
			h.run = h.pure
				? function (next, args) {
						const [before, order] = [items(next).length, items(next).map(id).join("\u0000")];
						run.call(this, next, args);
						after(this, next, before, order);
					}
				: function (next, args, ctx) {
						const [before, order] = [items(next).length, items(next).map(id).join("\u0000")];
						run.call(this, next, args, ctx);
						after(this, next, before, order);
					};
		}
	}
	return handlers;
};

export const components = { JsonView, DataTable, List };
