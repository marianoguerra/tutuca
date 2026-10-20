// A kanban board: columns of cards you drag within a column or across columns. Cards are
// draggable and drop targets: a drop on a card goes above or below it, by which half it lands
// on, and travels up as notifies (Card → Column → Board). A drop elsewhere in a column reaches
// the board's wrapper around it. Either way the board moves the card by the id of the value
// dragged. The host marks the target under the drag with data-draggingover, which the styles
// highlight.
import {
	component,
	each,
	field,
	renderEach,
	renderIt,
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
			run(_draft, _args, ctx) {
				ctx.notify("removeCard");
			},
		},
		// Something dropped on this card: a card goes above or below it.
		dropped: {
			args: [],
			emits: { notify: ["cardDropped"] },
			run(_draft, _args, ctx) {
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
	methods: {
		get count() {
			return this.cards.length;
		},
	},
	on: {
		setText: {
			args: [t.string()],
			run(draft, [text]) {
				draft.text = text;
			},
		},
		add: {
			args: [],
			run(draft, _args, ctx) {
				ctx.event?.preventDefault();
				const title = this.text.trim();
				if (title === "") return;
				draft.cards.push(ctx.scope.make("Card", { id: ctx.uuid(), title }));
				draft.text = "";
			},
		},
		// From a card, which ctx.sourceKey points at.
		removeCard: {
			args: [],
			sourceKey: t.index("cards"),
			post: (prev, next) => next.cards.length === prev.cards.length - 1,
			run(draft, _args, ctx) {
				draft.cards.splice(ctx.sourceKey, 1);
				ctx.stopNext();
			},
		},
		// From the card at ctx.sourceKey: the card id was dropped on it, below it if after.
		cardDropped: {
			args: [t.string(), t.boolean()],
			sourceKey: t.index("cards"),
			emits: { notify: ["moveCard"] },
			run(_draft, [id, after], ctx) {
				ctx.stopNext();
				ctx.notify("moveCard", [id, ctx.sourceKey + (after ? 1 : 0)]);
			},
		},
	},
});

// Moves the card id to position at of column to, wherever it is now.
const moveCard = (self, draft, id, to, at) => {
	const from = self.columns.findIndex((column) => column.cards.some((c) => c.id === id));
	if (from === -1) return;
	const cardIndex = self.columns[from].cards.findIndex((c) => c.id === id);
	const card = self.columns[from].cards[cardIndex];
	// Its own place doesn't count once it's taken out.
	const target = from === to && at > cardIndex ? at - 1 : at;
	draft.columns[from].cards.splice(cardIndex, 1);
	draft.columns[to].cards.splice(target, 0, card);
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

export const Board = component({
	name: "Board",
	fields: { columns: t.array(t.component("Column")) },
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
			run(draft, [to], ctx) {
				const id = draggedCardId(ctx);
				if (id !== undefined)
					moveCard(this, draft, id, to, dropIndex(ctx.node, ctx.event?.clientY));
			},
		},
		// From the column at ctx.sourceKey: the card id was dropped on one of its cards.
		moveCard: {
			args: [t.string(), t.number().int().min(0)],
			sourceKey: t.index("columns"),
			run(draft, [id, at], ctx) {
				ctx.stopNext(); // The board may be inside another component.
				moveCard(this, draft, id, ctx.sourceKey, at);
			},
		},
	},
});

export const kanbanComponents = { Board, Column, Card };
