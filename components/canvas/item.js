// An item of a canvas (index.js): a component at a point of it, with its chrome, shown while
// the pointer is over it: a header to drag it by, collapse it, toggle editing it, clone it or
// remove it, and a corner to resize it by. A content that says what its data is (DATA_META) can
// be downloaded from the header, and a file of its format dropped on it is loaded into it.

import { dataOf, fileFormatOf, hasAgentMeta, hasDataMeta, loadData } from "../../src/meta/index.js";
import {
	$if,
	component,
	field,
	provided,
	pushView,
	query,
	render,
	scopeOf,
	send,
	specOf,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { agent } from "../agent/index.js";
import { setField } from "../common/card.js";
import { fileDrop } from "../common/drop.js";
import { DROP_TARGET } from "../common/files.js";
import { clamp, isModKey } from "../common/util.js";
import { capture, coord, svgPoint } from "../drawing/shapes.js";
import { BECOME_ARGS, canvasMetaOf } from "./layout.js";

const { button, div, foreignObject, header, input, p, span } = tag;

// Taller than any item: the foreignObject's height, which the pointer goes through.
const ROOM = 4000;
export const HOLE_WIDTH = 240;
export const MIN_WIDTH = 160;
export const MIN_HEIGHT = 80;
// How tall an item grows with its content before its content scrolls; resizing it sets its
// height, past this too.
export const MAX_AUTO_HEIGHT = 720;
// How wide an item wrapped in an agent gets, at least.
const AGENT_WIDTH = 900;

// Runs fn once the render the handler causes is done: scrolling has to wait for the new size.
export const afterRender = (fn) => {
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
};

// The chrome's parts are invisible until the pointer is over the item's card or something in it
// has the focus; till then the card is transparent too, its content on the canvas. Collapsed,
// there's no content to show where it is: its header and border stay, faded.
const CHROME =
	"opacity-0 [.canvas-card:hover>&]:opacity-100 [.canvas-card:focus-within>&]:opacity-100";
const SHOWN =
	"opacity-80 [.canvas-card:hover>&]:opacity-100 [.canvas-card:focus-within>&]:opacity-100";
const HEADER =
	"flex shrink-0 cursor-grab items-center gap-1 rounded-t-box border-b border-base-300 bg-base-200 px-2 py-1 transition-opacity select-none active:cursor-grabbing";
const CARD =
	"canvas-card relative flex flex-col rounded-box border transition-[background-color,border-color,box-shadow] hover:border-base-300 hover:bg-base-100 hover:shadow-md focus-within:border-base-300 focus-within:bg-base-100 focus-within:shadow-md";
const CARD_OPEN = `${CARD} border-transparent bg-transparent`;
// Holding anything but a layout or a hole, it keeps its background, or it'd blend into the
// canvas.
const CARD_BACKED = `${CARD} border-transparent bg-base-100`;
const CARD_COLLAPSED = `${CARD} border-base-300/60 bg-transparent`;
const HEADER_OPEN = `${HEADER} ${CHROME}`;
const HEADER_COLLAPSED = `${HEADER} rounded-b-box border-b-0 ${SHOWN}`;

// Where an item's content shows, open: with drop, a file dropped on it loads into it, with
// the last drop's error under it. Main pushed too, so a nested item's content isn't edited with
// this one's.
const contentArea = (drop) =>
	div(
		drop
			? { class: `min-h-0 flex-1 overflow-auto p-3 ${DROP_TARGET}`, "on:drop": send("dropFile") }
			: { class: "min-h-0 flex-1 overflow-auto p-3" },
		pushView(field("pushed"), render(field("content"))),
		drop
			? $if(field("hasDropError"), p({ class: "text-xs text-error" }, field("dropError")), "")
			: "",
	);

// One component on the canvas, at x, y, with a chrome shown while the pointer is over it: a
// header to drag it by, collapse it, toggle editing it, clone it or remove it, and a corner to
// resize it by. Its height is its content's until it's resized (0). Editing, it pushes the edit view above
// its content, for the components that have one (the layouts).
// A file dropped from outside the page on an item's content: the first one of its data's file
// format, loaded into its content when it fits.
const itemDrop = fileDrop({
	enabled: (self) => self.canLoad,
	format: (self) => self.fileFormat,
	load(self, next, value, name) {
		const loaded = loadData(self.content, value, name);
		if (loaded.error !== undefined) return loaded.error;
		next.content = loaded.next;
		return "";
	},
});
export const Item = component({
	name: "Item",
	fields: {
		content: t.component(),
		x: coord(),
		y: coord(),
		width: t.number().int().min(MIN_WIDTH).max(4000).default(HOLE_WIDTH),
		height: t.number().int().min(0).max(4000),
		collapsed: t.boolean(),
		// The name given in its header; empty, the header says what it holds.
		title: t.string(),
		// Whether its content shows its edit view: a mode, not part of what's on the canvas.
		editing: t.boolean().sync("none"),
		// What the header says while the title is empty: what it holds.
		label: t.string().default("Empty"),
		// Its width before its content was wrapped in an agent, which ejecting it gets back.
		unwrappedWidth: t.number().int().min(0).max(4000),
		// The file dropped on its content last, while it's read, and why it didn't load.
		dropName: t.string().sync("none"),
		dropError: t.string().sync("none"),
	},
	queries: {
		get isOpen() {
			return !this.collapsed;
		},
		get cardClass() {
			if (this.collapsed) return CARD_COLLAPSED;
			return canvasMetaOf(this.content).transparent ? CARD_OPEN : CARD_BACKED;
		},
		get headerClass() {
			return this.collapsed ? HEADER_COLLAPSED : HEADER_OPEN;
		},
		get chevron() {
			return this.collapsed ? "▸" : "▾";
		},
		// Whether its content has an edit view to toggle to.
		get canEdit() {
			return specOf(this.content).views.edit !== undefined;
		},
		get pushed() {
			return this.editing && this.canEdit ? "edit" : "main";
		},
		get editLabel() {
			return this.editing ? "Use it" : "Edit it";
		},
		get editIcon() {
			return this.editing ? "👁" : "✎";
		},
		get shownTitle() {
			return this.title === "" ? this.label : this.title;
		},
		// Whether its content loads a dropped file, saying what its data is.
		get canLoad() {
			return hasDataMeta(this.content);
		},
		// The file its content's data reads and saves as: JSON, or the text file it says.
		get fileFormat() {
			return fileFormatOf(this.content);
		},
		// What its download button says: the file it saves as, and that one dropped loads.
		get downloadLabel() {
			return `Download as ${this.fileFormat.json ? "JSON" : this.fileFormat.extensions[0]}`;
		},
		get downloadTitle() {
			const what = this.fileFormat.json ? "a JSON" : `a ${this.fileFormat.extensions[0]}`;
			return `${this.downloadLabel} (drop ${what} file on it to load one)`;
		},
		// Whether its content can be downloaded: it says a query that reads its data.
		get canSave() {
			return this.canLoad && dataOf(this.content).data !== null;
		},
		get hasDropError() {
			return this.dropError !== "";
		},
		// The name its data downloads as: its title's or its label's words, then its file's
		// extension (.json unless its data meta says another).
		get fileName() {
			const words = this.shownTitle.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
			return `${words.join("-") || "data"}${this.fileFormat.extensions[0]}`;
		},
		// Whether its content says agent meta and an agent can be made here to wrap it.
		get canWrap() {
			return hasAgentMeta(this.content) && Boolean(scopeOf(this).lookupByName("Agent"));
		},
		// Whether its content is an agent wrapping something, which it can eject.
		get isWrapped() {
			return specOf(this.content).name === "Agent" && hasAgentMeta(this.content.target);
		},
		// Resized, the card keeps its height and its content scrolls; till then it's as tall as
		// its content, up to MAX_AUTO_HEIGHT; collapsed, it's the header.
		get cardStyle() {
			if (this.collapsed) return "pointer-events:auto";
			const height =
				this.height === 0 ? `max-height:${MAX_AUTO_HEIGHT}px;` : `height:${this.height}px;`;
			return `${height}pointer-events:auto`;
		},
	},
	view: foreignObject(
		{
			x: field("x"),
			y: field("y"),
			width: field("width"),
			height: String(ROOM),
			style: "pointer-events:none;overflow:visible",
		},
		div(
			{
				class: field("cardClass"),
				style: field("cardStyle"),
				// Its chrome pressed (the card around its content), it comes to the front; a press in
				// its content is its content's.
				"on:pointerdown": send("raise"),
			},
			header(
				{
					class: field("headerClass"),
					style: "touch-action:none",
					title: "Drag to move",
					"on:pointerdown": send("grab"),
				},
				span({ class: "opacity-40", "aria-hidden": "true" }, "⠿"),
				button(
					{
						class: "btn btn-ghost btn-xs w-6 px-0",
						title: "Collapse or expand (Ctrl+click: every item)",
						"aria-expanded": $if(field("isOpen"), "true", "false"),
						"on:click": send("toggle"),
					},
					field("chevron"),
				),
				input({
					class:
						"input input-ghost input-xs min-w-0 flex-1 truncate px-1 text-xs font-bold opacity-60 focus:opacity-100",
					"aria-label": "Title",
					value: field("title"),
					placeholder: field("label"),
					"on:input": send("setTitle", targetValue()),
				}),
				$if(
					field("canEdit"),
					button(
						{
							class: "btn btn-ghost btn-xs w-6 px-0",
							title: field("editLabel"),
							"aria-label": field("editLabel"),
							"aria-pressed": $if(field("editing"), "true", "false"),
							"on:click": send("toggleEditing"),
						},
						field("editIcon"),
					),
					"",
				),
				// With a model to ask (the canvas provides whether there is one), a component that
				// says agent meta can be wrapped in an agent; a wrapped one can be ejected again.
				$if(
					field("canWrap"),
					$if(
						provided("agentsAvailable"),
						button(
							{
								class: "btn btn-ghost btn-xs w-6 px-0",
								title: "Wrap in an agent",
								"aria-label": "Wrap in an agent",
								"on:click": send("wrapInAgent"),
							},
							"🤖",
						),
						"",
					),
					"",
				),
				$if(
					field("isWrapped"),
					button(
						{
							class: "btn btn-ghost btn-xs w-6 px-0",
							title: "Eject it from the agent",
							"aria-label": "Eject it from the agent",
							"on:click": send("ejectAgent"),
						},
						"⏏",
					),
					"",
				),
				button(
					{
						class: "btn btn-ghost btn-xs w-6 px-0",
						title: "Maximize",
						"aria-label": "Maximize",
						"on:click": send("maximize"),
					},
					"⤢",
				),
				$if(
					field("canSave"),
					button(
						{
							class: "btn btn-ghost btn-xs w-6 px-0",
							title: field("downloadTitle"),
							"aria-label": field("downloadLabel"),
							"on:click": send("download"),
						},
						"⤓",
					),
					"",
				),
				button(
					{
						class: "btn btn-ghost btn-xs w-6 px-0",
						title: "Clone",
						"aria-label": "Clone",
						"on:click": send("clone"),
					},
					"⧉",
				),
				button({ class: "btn btn-ghost btn-xs", title: "Remove", "on:click": send("remove") }, "✕"),
			),
			$if(
				field("isOpen"),
				// Only a content that loads data takes a drop: a drop handler takes it whether it
				// does anything or not, so the others leave it to what's around.
				$if(field("canLoad"), contentArea(true), contentArea(false)),
				"",
			),
			div({
				class:
					"absolute right-0 bottom-0 size-4 cursor-nwse-resize rounded-br-box opacity-0 transition-opacity [.canvas-card:focus-within>&]:opacity-50 [.canvas-card:hover>&]:opacity-50 [.canvas-card:hover>&:hover]:opacity-100",
				style:
					"touch-action:none;background:linear-gradient(135deg,transparent 50%,currentColor 50% 60%,transparent 60% 70%,currentColor 70% 80%,transparent 80%)",
				title: "Drag to resize",
				"on:pointerdown": send("grabCorner"),
			}),
		),
	),
	// Maximized: over the whole page, as tall as its content, which scrolls past the window.
	views: {
		full: div(
			{
				class: "canvas-maximized fixed inset-0 z-50 flex items-start bg-base-300/70 p-4 sm:p-8",
				role: "dialog",
				"on:keydown": send("fullKey"),
				"aria-modal": "true",
				"aria-label": field("shownTitle"),
			},
			div(
				{
					class:
						"mx-auto flex max-h-full w-full max-w-5xl flex-col rounded-box border border-base-300 bg-base-100 shadow-xl",
				},
				header(
					{
						class:
							"flex shrink-0 items-center gap-1 rounded-t-box border-b border-base-300 bg-base-200 px-2 py-1",
					},
					span(
						{ class: "min-w-0 flex-1 truncate px-1 text-sm font-bold opacity-60" },
						field("shownTitle"),
					),
					$if(
						field("canEdit"),
						button(
							{
								class: "btn btn-ghost btn-xs w-6 px-0",
								title: field("editLabel"),
								"aria-label": field("editLabel"),
								"aria-pressed": $if(field("editing"), "true", "false"),
								"on:click": send("toggleEditing"),
							},
							field("editIcon"),
						),
						"",
					),
					button(
						{
							class: "btn btn-ghost btn-xs",
							title: "Restore (Esc)",
							"aria-label": "Restore",
							"on:click": send("restore"),
						},
						"⤡ Restore",
					),
				),
				div(
					{ class: "min-h-0 flex-1 overflow-auto p-4" },
					pushView(field("pushed"), render(field("content"))),
				),
			),
		),
	},
	on: {
		// With Ctrl (⌘ on a Mac) held, every item on the canvas does the same.
		toggle: {
			args: [],
			emits: { notify: ["collapseAll"] },
			run(next, _args, ctx) {
				const collapsed = !this.collapsed;
				if (isModKey(ctx.event)) ctx.notify("collapseAll", [collapsed]);
				else next.collapsed = collapsed;
			},
		},
		setCollapsed: setField("collapsed", t.boolean(), { pure: true }),
		// Maximized, the focus goes to its Restore button, so Esc reaches it.
		maximize: {
			args: [],
			emits: { notify: ["maximizeItem"] },
			run(_next, _args, ctx) {
				ctx.notify("maximizeItem");
				const root = ctx.event?.target?.closest?.(".canvas-root");
				afterRender(() => root?.querySelector('.canvas-maximized [aria-label="Restore"]')?.focus());
			},
		},
		fullKey: {
			args: [],
			emits: { notify: ["restoreItem"] },
			run(_next, _args, ctx) {
				const e = ctx.event;
				if (e?.key !== "Escape" || e.defaultPrevented) return;
				e.preventDefault();
				ctx.notify("restoreItem");
			},
		},
		restore: {
			args: [],
			emits: { notify: ["restoreItem"] },
			run(_next, _args, ctx) {
				ctx.notify("restoreItem");
			},
		},
		setTitle: setField("title", t.string(), { pure: true }),
		// width wide and height tall; 0 tall, as tall as its content.
		setSize: {
			pure: true,
			args: [t.number(), t.number()],
			run(next, [width, height]) {
				next.width = clamp(Math.round(width), MIN_WIDTH, 4000);
				next.height = height <= 0 ? 0 : clamp(Math.round(height), MIN_HEIGHT, 4000);
			},
		},
		toggleEditing(next) {
			next.editing = !this.editing;
		},
		moveTo: {
			pure: true,
			args: [coord(), coord()],
			run(next, [x, y]) {
				next.x = x;
				next.y = y;
			},
		},
		resizeTo: {
			pure: true,
			args: [t.number(), t.number()],
			run(next, [width, height]) {
				next.width = clamp(Math.round(width), MIN_WIDTH, 4000);
				next.height = clamp(Math.round(height), MIN_HEIGHT, 4000);
			},
		},
		// Its content becomes content, labeled label, width wide (0 keeps its width) and as tall
		// as it is; one with an edit view starts edited, to fill it in.
		setContent: {
			pure: true,
			args: BECOME_ARGS,
			run(next, [content, label, width]) {
				next.content = content;
				next.label = label;
				next.editing = specOf(content).views.edit !== undefined;
				if (width > 0) next.width = clamp(width, MIN_WIDTH, 4000);
				next.height = 0;
			},
		},
		// Its content in an agent that drives it, wider to fit the chat beside it.
		wrapInAgent: {
			args: [],
			pre: (self) => self.canWrap,
			run(next, _args, ctx) {
				const C = ctx.scope.components;
				// The agent asks which models there are, to start with one.
				ctx.sendAt("loadModels", [], (s) => s.field("content"));
				next.content = agent(C, { target: this.content, canChange: false });
				next.unwrappedWidth = this.width;
				next.width = clamp(Math.max(this.width * 2, AGENT_WIDTH), MIN_WIDTH, 4000);
				next.height = 0;
				next.editing = false;
			},
		},
		// The agent's component back in its place, as the agent left it, as wide as it was.
		ejectAgent: {
			pure: true,
			args: [],
			pre: (self) => self.isWrapped,
			run(next) {
				next.content = this.content.target;
				if (this.unwrappedWidth > 0) next.width = this.unwrappedWidth;
				next.unwrappedWidth = 0;
				next.height = 0;
			},
		},
		// Its content's data, downloaded as a file: JSON, or its text as is when its data is a
		// text file.
		download: {
			args: [],
			pre: (self) => self.canSave,
			emits: { ask: ["saveFile"] },
			run(_next, _args, ctx) {
				const data = query(this.content, dataOf(this.content).data);
				const format = this.fileFormat;
				const text = format.json ? `${JSON.stringify(data, null, 2)}\n` : data;
				ctx.ask("saveFile", [this.fileName, text, format.type]);
			},
		},
		...itemDrop.on,
		raise: {
			args: [],
			emits: { notify: ["raiseItem"] },
			run(_next, _args, ctx) {
				ctx.notify("raiseItem");
			},
		},
		clone: {
			args: [],
			emits: { notify: ["cloneItem"] },
			run(_next, _args, ctx) {
				ctx.notify("cloneItem");
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeItem"] },
			run(_next, _args, ctx) {
				ctx.notify("removeItem");
			},
		},
		// The header pressed, not one of its buttons or its title: the canvas picks the item up.
		grab: {
			args: [],
			emits: { notify: ["pickUp", "raiseItem"] },
			run(_next, _args, ctx) {
				// Checked before pressPoint captures the pointer: a captured press never clicks. A
				// button or the title pressed still brings the item to the front.
				if (ctx.event?.target?.closest?.("button, input")) {
					ctx.notify("raiseItem");
					return;
				}
				const point = pressPoint(ctx.event);
				if (point === null) return;
				ctx.notify("pickUp", point);
			},
		},
		// The corner pressed: the canvas resizes the item from its size now, as it shows.
		grabCorner: {
			args: [],
			emits: { notify: ["pickUpCorner"] },
			run(_next, _args, ctx) {
				const point = pressPoint(ctx.event);
				if (point === null) return;
				const shown = ctx.event.target.closest?.(".canvas-card")?.offsetHeight ?? 0;
				ctx.notify("pickUpCorner", [...point, this.height || shown]);
			},
		},
		// From the hole, on its way to the canvas, which makes what it becomes.
		become: { args: BECOME_ARGS, run() {} },
	},
	answers: {
		...itemDrop.answers,
		saveFile: { ok() {} },
	},
});

// Where a primary press is, in its canvas, capturing the pointer there; null for other presses.
const pressPoint = (event) => {
	if (!event || event.button > 0) return null;
	const point = svgPoint(event);
	if (point === null) return null;
	event.preventDefault(); // No text selection while dragging.
	capture(event);
	return point;
};
