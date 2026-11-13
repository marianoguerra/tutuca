// A kanban board: columns of cards you drag within a column or across columns. Cards are
// draggable and drop targets: a drop on a card goes above or below it, by which half it lands
// on, and travels up as notifies (Card → Column → Board). A drop elsewhere in a column reaches
// the board's wrapper around it. Either way the board moves the card by the id of the value
// dragged. The host marks the target under the drag with data-draggingover, which the styles
// highlight.
//
// Its other renders nest three levels down, as its views do: the board's renders.tui, js, md
// and llmContext render each column's, which render each card's (the Renders demo shows them).
// A terminal can't drag, so a card there has ← and → boxes that shift it a column; a model
// moves cards with the board's tools, and adds them with each column's.

import { js, jsTarget } from "../../src/jsast/target.js";
import {
	llmContext,
	llmContextTarget,
	llmTools,
	llmToolsTarget,
	toolArg,
	Unless,
	When,
} from "../../src/llm/target.js";
import { md, mdTarget } from "../../src/mdast/target.js";
import { AGENT_META, agentTool, DATA_META } from "../../src/meta/index.js";
import { tuiTarget } from "../../src/tui/target.js";
import {
	$if,
	apply,
	component,
	each,
	enableTargets,
	field,
	lookupBind,
	renderEach,
	renderIt,
	scopeOf,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { setField } from "../common/card.js";
import { metaFor } from "../common/meta.js";

enableTargets(tuiTarget, jsTarget, mdTarget, llmContextTarget, llmToolsTarget);

const { box, button, div, form, h2, input, section, span, text } = tag;
const { ArrayExpression, CallExpression, Identifier, Literal, MemberExpression } = js;
const { ObjectExpression, Property } = js;
const { arguments: args, callee, elements, key, object, properties, property, value } = js;
const { Heading, List, ListItem, Paragraph, Root, Strong } = md;
const { Code, Hint, Item, Items, Section, Text } = llmContext;
const { Enum, Int, Option, Str, Tool, Tools } = llmTools;

// C.Name({ field: value, ... }): the code that makes a component in a state, with a scope's
// components, as a story's make does.
const make = (name, ...props) =>
	CallExpression(
		callee(MemberExpression(object(Identifier({ name: "C" })), property(Identifier({ name })))),
		args(ObjectExpression(properties(...props))),
	);
const prop = (name, node) => Property({ kind: "init" }, key(Identifier({ name })), value(node));
// A field that's a string, a boolean or a number that can't be negative.
const literal = (name) => prop(name, Literal({ value: field(name) }));
// A title as part of a tool's name, which can only have letters, digits, _ and -.
const slug = (title) =>
	title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "");

// Whether the drop landed on the lower half of the element that handles it; a drop without a
// position, as in tests, goes above.
const isLowerHalf = ({ event, node }) => {
	if (node === null || typeof event?.clientY !== "number") return false;
	const rect = node.getBoundingClientRect();
	return event.clientY > rect.top + rect.height / 2;
};
// The id of the card being dragged, if a card is.
const draggedCardId = (ctx) => (ctx.drag?.type === "card" ? ctx.drag.value?.id : undefined);

export const Card = component({
	name: "Card",
	fields: { id: t.string(), title: t.string() },
	view: div(
		{
			class:
				"flex cursor-grab items-center gap-2 rounded-box border border-base-300 bg-base-100 px-3 py-2 shadow-sm data-[dragging]:opacity-40 data-[draggingover=card]:border-primary data-[draggingover=card]:bg-primary/10 data-[draggingover=card]:ring-2 data-[draggingover=card]:ring-primary",
			draggable: "true",
			"data-dragtype": "card",
			"on:drop": send("dropped"),
		},
		span({ class: "flex-1" }, field("title")),
		button({ class: "btn btn-ghost btn-xs", title: "Remove", "on:click": send("remove") }, "✕"),
	),
	renders: {
		// ← and → shift it a column, as a drag across columns does on the page.
		tui: box(
			{ flexDirection: "row", gap: "1" },
			box({ focusable: "true", dim: "true", "on:click": send("shift", -1) }, "←"),
			text({ flexGrow: "1", flexShrink: "1" }, field("title")),
			box({ focusable: "true", dim: "true", "on:click": send("shift", 1) }, "→"),
			box({ focusable: "true", color: "red", "on:click": send("remove") }, "✕"),
		),
		js: make("Card", literal("id"), literal("title")),
		md: ListItem(Paragraph(field("title"))),
		// The id is what the board's tools take.
		llmContext: Item(field("title"), " ", Code(field("id"))),
	},
	on: {
		// Shifts it by columns, by: its column says which card, the board moves it.
		shift: {
			args: [t.number().int()],
			emits: { notify: ["cardShifted"] },
			run(_next, [by], ctx) {
				ctx.notify("cardShifted", [by]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeCard"] },
			run(_next, _args, ctx) {
				ctx.notify("removeCard");
			},
		},
		// Something dropped on this card: a card goes above or below it.
		dropped: {
			args: [],
			emits: { notify: ["cardDropped"] },
			run(_next, _args, ctx) {
				const id = draggedCardId(ctx);
				if (id !== undefined) ctx.notify("cardDropped", [id, isLowerHalf(ctx)]);
			},
		},
	},
});

export const Column = component({
	name: "Column",
	fields: {
		title: t.string(),
		cards: t.array(t.component("Card")),
		text: t.string().sync("none"), // The new card's title, being typed.
	},
	view: section(
		{ class: "flex flex-col gap-2" },
		h2(
			{ class: "flex items-center justify-between font-bold" },
			span({}, field("title")),
			span({ class: "badge badge-sm" }, field("count")),
		),
		div({ class: "flex min-h-12 flex-col gap-2" }, renderEach(field("cards"))),
		form(
			{ class: "join", "on:submit": send("add") },
			input({
				class: "input input-sm join-item",
				placeholder: "New card",
				"aria-label": "New card",
				value: field("text"),
				"on:input": send("setText", targetValue()),
			}),
			button({ class: "btn btn-sm join-item" }, "Add"),
		),
	),
	queries: {
		get count() {
			return this.cards.length;
		},
		get addTool() {
			return `add_card_to_${slug(this.title)}`;
		},
	},
	renders: {
		// A column of the board's row: its cards, and an input that adds one on Enter.
		tui: box(
			{
				flexGrow: "1",
				flexBasis: "0",
				borderStyle: "round",
				borderText: field("title"),
				paddingX: "1",
			},
			renderEach(field("cards")),
			box(
				{ "on:submit": send("add") },
				input({
					placeholder: "New card",
					value: field("text"),
					"on:input": send("setText", targetValue()),
				}),
			),
		),
		// With what's typed in its input, which is its state too.
		js: make(
			"Column",
			literal("title"),
			prop("cards", ArrayExpression(elements(renderEach(field("cards"))))),
			literal("text"),
		),
		md: ListItem(
			Paragraph(Strong(field("title")), " (", field("count"), ")"),
			$if(field("count"), List(renderEach(field("cards"))), null),
		),
		// A section a level below the board's, its cards an item each.
		llmContext: Section(
			{ title: field("title") },
			Items({ empty: "No cards." }, renderEach(field("cards"))),
		),
		// Its tool, among the board's: a call adds to this column.
		llmTools: Tool(
			{ name: field("addTool"), "on:call": send("addCard", toolArg("title")) },
			"Add a card at the end of the ",
			field("title"),
			" column.",
			Str({ name: "title", minLength: 1 }, "The card's title."),
		),
	},
	on: {
		setText: setField("text"),
		add: {
			args: [],
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				const title = this.text.trim();
				if (title === "") return;
				next.cards.push(ctx.scope.make("Card", { id: ctx.uuid(), title }));
				next.text = "";
			},
		},
		// A card titled title at the end, leaving what's typed.
		addCard: {
			args: [t.string().len(1)],
			run(next, [title], ctx) {
				next.cards.push(ctx.scope.make("Card", { id: ctx.uuid(), title }));
			},
		},
		// What the board does to move a card: take it out, put it in at a position.
		takeCard: {
			pure: true,
			args: [t.index("cards")],
			run(next, [i]) {
				next.cards.splice(i, 1);
			},
		},
		putCard: {
			pure: true,
			args: [t.component("Card"), t.number().int().min(0)],
			run(next, [card, at]) {
				next.cards.splice(at, 0, card);
			},
		},
		// From a card, which ctx.sourceKey points at.
		removeCard: {
			args: [],
			sourceKey: t.index("cards"),
			post: (prev, next) => next.cards.length === prev.cards.length - 1,
			run(next, _args, ctx) {
				next.cards.splice(ctx.sourceKey, 1);
				ctx.stopNext();
			},
		},
		// From the card at ctx.sourceKey: shift it by columns.
		cardShifted: {
			args: [t.number().int()],
			sourceKey: t.index("cards"),
			emits: { notify: ["shiftCard"] },
			run(_next, [by], ctx) {
				ctx.stopNext();
				ctx.notify("shiftCard", [this.cards[ctx.sourceKey].id, by]);
			},
		},
		// From the card at ctx.sourceKey: the card id was dropped on it, below it if after.
		cardDropped: {
			args: [t.string(), t.boolean()],
			sourceKey: t.index("cards"),
			emits: { notify: ["moveCard"] },
			run(_next, [id, after], ctx) {
				ctx.stopNext();
				ctx.notify("moveCard", [id, ctx.sourceKey + (after ? 1 : 0)]);
			},
		},
	},
});

// Moves the card id to position at of column to, wherever it is now.
const moveCard = (self, next, id, to, at) => {
	const from = self.columns.findIndex((column) => column.cards.some((c) => c.id === id));
	if (from === -1) return;
	const cardIndex = self.columns[from].cards.findIndex((c) => c.id === id);
	const card = self.columns[from].cards[cardIndex];
	// Its own place doesn't count once it's taken out.
	const target = from === to && at > cardIndex ? at - 1 : at;
	next.columns[from] = apply(next.columns[from], "takeCard", cardIndex);
	next.columns[to] = apply(next.columns[to], "putCard", card, target);
};
// Where among the cards in node a drop at clientY goes: after every card whose middle is above
// it. Without a position, as in tests, at the end.
const dropIndex = (node, clientY) => {
	const cards = node === null ? [] : [...node.querySelectorAll('[data-dragtype="card"]')];
	if (typeof clientY !== "number") return cards.length;
	return cards.filter((el) => {
		const rect = el.getBoundingClientRect();
		return rect.top + rect.height / 2 < clientY;
	}).length;
};

// Where the card id is: [column, index], or null.
const findCard = (self, id) => {
	for (let i = 0; i < self.columns.length; i++) {
		const at = self.columns[i].cards.findIndex((c) => c.id === id);
		if (at !== -1) return [i, at];
	}
	return null;
};
const hasCard = (self, id) => findCard(self, id) !== null;
const hasColumn = (self, i) => Number.isInteger(i) && i >= 0 && i < self.columns.length;
// A board as plain JSON, what load takes and domain gives.
const boardJson = t.record({
	columns: t.array(
		t.record({
			title: t.string(),
			cards: t.array(t.record({ id: t.string(), title: t.string() })),
		}),
	),
});
const WEEK = {
	columns: [
		{
			title: "To do",
			cards: [
				{ id: "c00", title: "Write the drag and drop docs" },
				{ id: "c01", title: "Port the touch support" },
			],
		},
		{ title: "Doing", cards: [{ id: "c10", title: "Review the event routing" }] },
		{ title: "Done", cards: [] },
	],
};
const tool = agentTool;
// What the board's tools pick from: a card by its id, said with its title; a column by its
// index, said with its title.
const whichCard = Enum(
	"id",
	"Which card.",
	each(field("cardChoices"), Option(field("id"), field("label"))),
);
const whichColumn = Enum(
	"column",
	"Which column.",
	each(field("columns"), Option(lookupBind("key"), field("title"))),
);
// What the board says to an agent that drives it: its tools are its own messages and queries.
const AGENT = {
	prompt:
		"A kanban board: columns, by index from 0, of cards, each with an id and a title. Move cards between columns as work progresses.",
	summary: "summary",
	tools: [
		tool("add_card", "message", ["column", "title"], "Add a card at the end of a column."),
		tool("move_card", "message", ["id", "column", "at"], "Move a card to a position in a column."),
		tool("rename_card", "message", ["id", "title"], "Change a card's title."),
		tool("remove_card", "message", ["id"], "Remove a card."),
		tool("add_column", "message", ["title"], "Add a column at the end."),
		tool("cards_in", "query", ["column"], "The cards of a column, as JSON."),
	],
	skills: {
		"workflow.md":
			"Cards flow left to right: To do, Doing, Done. Keep at most 3 cards in Doing; when asked to start something with Doing full, say so instead.",
	},
};
// The board as JSON: load replaces it, domain reads it back.
const DATA = { load: "load", data: "domain", samples: { week: WEEK } };

export const Board = component({
	name: "Board",
	meta: metaFor("Kanban board", "🗂️", "Cards you drag between columns.", null, {
		[AGENT_META]: AGENT,
		[DATA_META]: DATA,
	}),
	fields: { columns: t.array(t.component("Column")) },
	queries: {
		// A line per column, with its index and its cards' ids, for the agent's prompt.
		get summary() {
			if (this.columns.length === 0) return "No columns.";
			return this.columns
				.map((col, i) => {
					const cards = col.cards.map((c) => `${c.id} "${c.title}"`).join(", ");
					return `${i}. ${col.title} (${col.cards.length}): ${cards || "empty"}`;
				})
				.join("\n");
		},
		get domain() {
			return {
				columns: this.columns.map((col) => ({
					title: col.title,
					cards: col.cards.map(({ id, title }) => ({ id, title })),
				})),
			};
		},
		// Every card, with its column's title: what the tools offer to pick from.
		get cardChoices() {
			return this.columns.flatMap((col) =>
				col.cards.map(({ id, title }) => ({ id, label: `${title} (in ${col.title})` })),
			);
		},
		get hasCards() {
			return this.columns.some((col) => col.cards.length > 0);
		},
		cards_in: {
			args: [t.number().int().min(0)],
			run(column) {
				return (this.columns[column]?.cards ?? []).map(({ id, title }) => ({ id, title }));
			},
		},
	},
	view: div(
		{ class: "grid gap-4 sm:grid-cols-3" },
		each(
			field("columns"),
			div(
				{
					// Over a card, the card is the drop target; elsewhere in the column, this is. A
					// transparent outline keeps the layout still when it turns on.
					class:
						"rounded-box border border-base-300 bg-base-200 p-3 outline-2 outline-dashed outline-offset-2 outline-transparent data-[draggingover=card]:bg-primary/10 data-[draggingover=card]:outline-primary",
					"on:drop": send("dropCard", sourceKey()),
				},
				renderIt(),
			),
		),
	),
	renders: {
		// The columns side by side, as on the page.
		tui: box({ flexDirection: "row", gap: "1" }, renderEach(field("columns"))),
		// C.Board({ columns: [C.Column({ title: "To do", cards: [C.Card({ ... })] }), ...] })
		js: make("Board", prop("columns", ArrayExpression(elements(renderEach(field("columns")))))),
		// A list item per column, a list of its cards in each.
		md: Root(
			Heading({ depth: 2 }, "Board"),
			$if(field("columns"), List(renderEach(field("columns"))), Paragraph("No columns.")),
		),
		llmContext: Section(
			"Kanban board",
			Text("Cards flow left to right through the columns as work progresses."),
			renderEach(field("columns")),
			Unless(field("columns"), Hint("There are no columns yet: offer to add some.")),
		),
		// The board's tools work across columns; each column adds its own tool, which adds to it.
		llmTools: Tools(
			When(
				field("hasCards"),
				Tool(
					"move_card",
					send("move_card", toolArg("id"), toolArg("column"), toolArg("at")),
					"Move a card to a position in a column.",
					whichCard,
					whichColumn,
					Int({ name: "at", min: 0 }, "Its position in the column, 0 for the top."),
				),
				Tool(
					"rename_card",
					send("rename_card", toolArg("id"), toolArg("title")),
					"Change a card's title.",
					whichCard,
					Str({ name: "title", minLength: 1 }, "The new title."),
				),
				Tool(
					"remove_card",
					send("remove_card", toolArg("id")),
					"Remove a card from the board.",
					whichCard,
				),
			),
			Tool(
				"add_column",
				send("add_column", toolArg("title")),
				"Add a column at the right end.",
				Str({ name: "title", minLength: 1 }, "The column's title."),
			),
			renderEach(field("columns")),
		),
	},
	invariants: {
		uniqueCardIds() {
			const ids = this.columns.flatMap((column) => column.cards.map((card) => card.id));
			return new Set(ids).size === ids.length;
		},
	},
	on: {
		// A card dropped on the column at index to, not on one of its cards; anything else
		// dropped is ignored.
		dropCard: {
			args: [t.index("columns")],
			run(next, [to], ctx) {
				const id = draggedCardId(ctx);
				if (id !== undefined) moveCard(this, next, id, to, dropIndex(ctx.node, ctx.event?.clientY));
			},
		},
		// The agent's: a new card, with a new id, at the end of column.
		add_card: {
			args: [t.number().int().min(0), t.string().len(1)],
			pre: (self, [column]) => hasColumn(self, column),
			why: (self, [column]) => `there's no column ${column}, there are ${self.columns.length}`,
			run(next, [column, title], ctx) {
				const card = ctx.scope.make("Card", { id: ctx.uuid(), title });
				next.columns[column] = apply(
					next.columns[column],
					"putCard",
					card,
					this.columns[column].cards.length,
				);
			},
		},
		move_card: {
			pure: true,
			args: [t.string(), t.number().int().min(0), t.number().int().min(0)],
			pre: (self, [id, column]) => hasCard(self, id) && hasColumn(self, column),
			why: (self, [id, column]) =>
				hasCard(self, id) ? `there's no column ${column}` : `there's no card ${id}`,
			run(next, [id, column, at]) {
				moveCard(this, next, id, column, Math.min(at, this.columns[column].cards.length));
			},
		},
		rename_card: {
			pure: true,
			args: [t.string(), t.string().len(1)],
			pre: (self, [id]) => hasCard(self, id),
			why: (_self, [id]) => `there's no card ${id}`,
			run(next, [id, title]) {
				const [column, at] = findCard(this, id);
				const card = scopeOf(this).make("Card", { id, title });
				const taken = apply(next.columns[column], "takeCard", at);
				next.columns[column] = apply(taken, "putCard", card, at);
			},
		},
		remove_card: {
			pure: true,
			args: [t.string()],
			pre: (self, [id]) => hasCard(self, id),
			why: (_self, [id]) => `there's no card ${id}`,
			run(next, [id]) {
				const [column, at] = findCard(this, id);
				next.columns[column] = apply(next.columns[column], "takeCard", at);
			},
		},
		add_column: {
			pure: true,
			args: [t.string().len(1)],
			run(next, [title]) {
				next.columns.push(scopeOf(this).make("Column", { title, cards: [] }));
			},
		},
		// The whole board from JSON, replacing it: the agent's samples start from here.
		load: {
			pure: true,
			args: [boardJson],
			pre: (_self, [board]) => {
				const ids = board.columns.flatMap((column) => column.cards.map((card) => card.id));
				return new Set(ids).size === ids.length;
			},
			why: () => "two cards have the same id",
			run(next, [board]) {
				const scope = scopeOf(this);
				next.columns = board.columns.map(({ title, cards }) =>
					scope.make("Column", {
						title,
						cards: cards.map((card) => scope.make("Card", card)),
					}),
				);
			},
		},
		// From the column at ctx.sourceKey: shift its card id by columns, to the end of the one
		// it lands in. Past the first or last column it stays.
		shiftCard: {
			args: [t.string(), t.number().int()],
			sourceKey: t.index("columns"),
			run(next, [id, by], ctx) {
				ctx.stopNext();
				const to = ctx.sourceKey + by;
				if (hasColumn(this, to)) moveCard(this, next, id, to, this.columns[to].cards.length);
			},
		},
		// From the column at ctx.sourceKey: the card id was dropped on one of its cards.
		moveCard: {
			args: [t.string(), t.number().int().min(0)],
			sourceKey: t.index("columns"),
			run(next, [id, at], ctx) {
				ctx.stopNext(); // The board may be inside another component.
				moveCard(this, next, id, ctx.sourceKey, at);
			},
		},
	},
});

export const kanbanComponents = { Board, Column, Card };
