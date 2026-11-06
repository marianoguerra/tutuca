// A kanban board: columns of cards you drag within a column or across columns. Cards are
// draggable and drop targets: a drop on a card goes above or below it, by which half it lands
// on, and travels up as notifies (Card → Column → Board). A drop elsewhere in a column reaches
// the board's wrapper around it. Either way the board moves the card by the id of the value
// dragged. The host marks the target under the drag with data-draggingover, which the styles
// highlight.
import {
	AGENT_META,
	apply,
	component,
	DATA_META,
	DISPLAY_META,
	each,
	field,
	renderEach,
	renderIt,
	scopeOf,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";

const { button, div, form, h2, input, section, span } = tag;

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
	on: {
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
	},
	on: {
		setText: {
			args: [t.string()],
			run(next, [text]) {
				next.text = text;
			},
		},
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
const tool = (name, kind, params, description) => ({
	name,
	kind,
	target: null,
	description,
	params,
	result: null,
});
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
	meta: {
		[DISPLAY_META]: {
			title: "Kanban board",
			icon: "🗂️",
			description: "Cards you drag between columns.",
		},
		[AGENT_META]: AGENT,
		[DATA_META]: DATA,
	},
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
