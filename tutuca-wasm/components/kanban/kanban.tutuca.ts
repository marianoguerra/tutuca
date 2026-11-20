// Kanban, a board of lanes holding cards: a card is dragged to another lane or onto a card (to go
// before it), added to the first lane, tagged and removed; a lane holding more cards than its
// limit says so. A module of its own that needs nothing from its scope, to export from the
// studio as a .wasm and drop on a screen elsewhere.
import type { Classes, Display } from "../meta/meta.tutuca";
import {
	button,
	div,
	each,
	field,
	h2,
	h3,
	header,
	input,
	li,
	lookupBind,
	renderEach,
	section,
	send,
	sourceKey,
	span,
	targetValue,
	ul,
	when,
} from "tutuca/view";
import { get } from "tutuca/data";

export type CardTag = "feature" | "bug" | "chore";
/** A card, with the id the board gave it. */
export type Card = { id: number; text: string; tag: CardTag };

/** feature, then bug, then chore, then feature again. */
function nextTag(tag: CardTag): CardTag {
	if (tag === "feature") return "bug";
	if (tag === "bug") return "chore";
	return "feature";
}

/** The board. Its lanes tell it where a card was dropped; it takes the card out of the lane it
 * was in and puts it in that one. It starts with three lanes (init) when it's made with none. */
export type Kanban = {
	title: string;
	lanes: KanbanLane[];
	draft: string;
	/** Above every card's id: the next card's. */
	nextId: number;
	/** "2 of 5 done": the last lane's cards of all. */
	readonly progress: string;
};

export const Kanban = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Kanban board",
			icon: "🗂️",
			description: "Cards you drag between columns.",
		},
	},
	defaults: { title: "Board", lanes: [], draft: "", nextId: 6 },
	constraints: { draft: { maxLength: 80 }, nextId: { int: true, min: 0 } },
	queries: {
		get progress(): string {
			let total = 0;
			let done = 0;
			for (const lane of this.lanes) {
				total += lane.cards.length;
				done = lane.cards.length;
			}
			return `${done} of ${total} done`;
		},
	},
	/** To do, Doing (at most 2) and Done, with a few cards, when made with no lanes. */
	init(next, ctx) {
		if (this.lanes.length > 0) return;
		next.lanes = [
			ctx.make("KanbanLane", {
				name: "todo",
				title: "To do",
				limit: 0,
				cards: [
					{ id: 1, text: "Drop a .wasm on a screen", tag: "feature" },
					{ id: 2, text: "Export the board", tag: "chore" },
					{ id: 3, text: "Cards forget their lane", tag: "bug" },
				],
			}),
			ctx.make("KanbanLane", {
				name: "doing",
				title: "Doing",
				limit: 2,
				cards: [{ id: 4, text: "Drag cards between lanes", tag: "feature" }],
			}),
			ctx.make("KanbanLane", {
				name: "done",
				title: "Done",
				limit: 0,
				cards: [{ id: 5, text: "Write the module", tag: "chore" }],
			}),
		];
	},
	on: {
		setDraft: {
			pure: true,
			changes: ["draft"],
			constraints: { text: { maxLength: 80 } },
			post(prev, next, [text]: [string]) {
				return next.draft === text;
			},
			run(next, [text]: [string]) {
				next.draft = text;
			},
		},
		/** The draft as a card at the end of the first lane; an empty one adds nothing. */
		addCard: {
			pure: true,
			changes: ["lanes", "draft", "nextId"],
			run(next, []: []) {
				const first = this.lanes[0];
				if (this.draft === "" || first === undefined) return;
				next.lanes[0] = tutuca.apply(first, "add", this.nextId, this.draft);
				next.draft = "";
				next.nextId = this.nextId + 1;
			},
		},
		/**
		 * A lane's notify: the card with id was dropped on it, before the card with before (-1: at
		 * the end). The lane it was dropped on puts it in; every other lane takes it out, both
		 * applied in this task, so the card is never in two lanes or none. The notify is the
		 * board's: it goes no further up.
		 */
		cardDropped: {
			sourceKey: { keyOf: "lanes" },
			changes: ["lanes"],
			constraints: { id: { int: true }, before: { int: true } },
			run(next, [id, before]: [number, number], ctx) {
				ctx.stopNext();
				const to = ctx.sourceKey;
				if (to === undefined) return;
				let card: Card | undefined = undefined;
				for (const lane of this.lanes) {
					const found = lane.cards.find((c) => c.id === id);
					if (found !== undefined) card = found;
				}
				if (card === undefined) return;
				const moved = card;
				next.lanes = this.lanes.map((lane, i) =>
					i === to ? tutuca.apply(lane, "put", moved, before) : tutuca.apply(lane, "take", id),
				);
			},
		},
	},
	view: section(
		{ class: "kanban flex flex-col gap-3 p-3 h-full min-h-0" },
		header(
			{ class: "flex flex-wrap items-center gap-2" },
			h2({ class: "text-lg font-bold flex-1" }, field("title")),
			span({ class: "kanban-progress text-sm opacity-70 tabular-nums" }, field("progress")),
			div(
				{ class: "join" },
				input({
					class: "kanban-draft input input-sm join-item w-56",
					placeholder: "A new card",
					"aria-label": "New card",
					value: field("draft"),
					"on:input": send("setDraft", targetValue()),
					"on:keydown+enter+prevent": send("addCard"),
				}),
				button({ class: "btn btn-sm btn-primary join-item", "on:click": send("addCard") }, "add"),
			),
		),
		div(
			{
				class:
					"kanban-lanes grid grid-flow-col auto-cols-[minmax(12rem,1fr)] gap-3 flex-1 min-h-0 overflow-x-auto",
			},
			renderEach(field("lanes")),
		),
	),
};

/** A lane: its cards. limit is how many it should hold (0 for no limit). */
export type KanbanLane = {
	name: string;
	title: string;
	limit: number;
	cards: Card[];
	/** "2" or, with a limit, "2/3". */
	readonly count: string;
	/** Whether it holds more cards than its limit. */
	readonly over: boolean;
};
export interface KanbanLaneNotifies {
	/** To the board: the card with id was dropped here, before the card with before (-1: at the end). */
	cardDropped(id: number, before: number): void;
}

const TAG_CLASS = "kanban-tag badge badge-sm w-fit cursor-pointer";

export const KanbanLane = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Kanban lane",
			icon: "📋",
			description: "A column of cards, with how many it should hold.",
		},
		// The tag badge's classes, which its loop's enrich computes.
		"https://tutuca.dev/meta/classes": {
			classes: "kanban-tag badge badge-sm w-fit cursor-pointer badge-error badge-neutral badge-info",
		},
	},
	defaults: { name: "", title: "", limit: 0, cards: [] },
	constraints: { limit: { int: true, min: 0 } },
	queries: {
		get count(): string {
			return this.limit === 0 ? `${this.cards.length}` : `${this.cards.length}/${this.limit}`;
		},
		get over(): boolean {
			return this.limit > 0 && this.cards.length > this.limit;
		},
	},
	on: {
		/** What's dragged, dropped on the lane: at its end, when it's a card. */
		dropHere: {
			changes: [],
			run(next, [], ctx) {
				const dragged = ctx.drag;
				if (dragged === null) return;
				const id = get(dragged.value, "id");
				if (typeof id === "number") ctx.notify("cardDropped", [id, -1]);
			},
		},
		/** What's dragged, dropped on the card at: before it. */
		dropBefore: {
			changes: [],
			constraints: { at: { keyOf: "cards" } },
			run(next, [at]: [number | null], ctx) {
				const dragged = ctx.drag;
				const target = at === null ? undefined : this.cards[at];
				if (dragged === null || target === undefined) return;
				const id = get(dragged.value, "id");
				if (typeof id === "number" && id !== target.id) ctx.notify("cardDropped", [id, target.id]);
			},
		},
		/** Applied by the board: the card with id leaves this lane, if it's here. */
		take: {
			pure: true,
			changes: ["cards"],
			constraints: { id: { int: true } },
			run(next, [id]: [number]) {
				if (this.cards.some((c) => c.id === id)) next.cards = this.cards.filter((c) => c.id !== id);
			},
		},
		/** Applied by the board: card joins this lane, before the card with before (at the end when
		 * there's none), out of wherever it was in it. */
		put: {
			pure: true,
			changes: ["cards"],
			constraints: { before: { int: true } },
			run(next, [card, before]: [Card, number]) {
				const out: Card[] = [];
				let placed = false;
				for (const c of this.cards) {
					if (c.id === card.id) continue;
					if (c.id === before) {
						out.push(card);
						placed = true;
					}
					out.push(c);
				}
				if (!placed) out.push(card);
				next.cards = out;
			},
		},
		/** Applied by the board: a new card at the end. */
		add: {
			pure: true,
			changes: ["cards"],
			constraints: { id: { int: true } },
			post(prev, next, [id, text]: [number, string]) {
				return next.cards.length === prev.cards.length + 1;
			},
			run(next, [id, text]: [number, string]) {
				next.cards.push({ id, text, tag: "feature" });
			},
		},
		/** The card at leaves. */
		removeCard: {
			pure: true,
			changes: ["cards"],
			constraints: { at: { keyOf: "cards" } },
			run(next, [at]: [number | null]) {
				if (at !== null && this.cards[at] !== undefined) next.cards.splice(at, 1);
			},
		},
		/** The card at's tag: feature, then bug, then chore, then feature again. */
		cycleTag: {
			pure: true,
			changes: ["cards"],
			constraints: { at: { keyOf: "cards" } },
			post(prev, next, [at]: [number | null]) {
				return next.cards.length === prev.cards.length;
			},
			run(next, [at]: [number | null]) {
				const card = at === null ? undefined : this.cards[at];
				if (at === null || card === undefined) return;
				next.cards[at] = { id: card.id, text: card.text, tag: nextTag(card.tag) };
			},
		},
	},
	loops: {
		cards: {
			/** The tag's badge class. */
			enrich(key: number, card: Card) {
				const color =
					card.tag === "bug" ? "badge-error" : card.tag === "chore" ? "badge-neutral" : "badge-info";
				return { tagClass: `${TAG_CLASS} ${color}` };
			},
		},
	},
	view: div(
		{
			class: when(
				field("over"),
				"kanban-lane over flex flex-col gap-2 rounded-box border-2 border-error bg-base-300/60 p-2 min-h-40 transition-colors data-draggingover:bg-error/10",
				"kanban-lane flex flex-col gap-2 rounded-box border-2 border-transparent bg-base-300/60 p-2 min-h-40 transition-colors data-draggingover:border-primary data-draggingover:bg-primary/10",
			),
			"data-lane": field("name"),
			"on:drop": send("dropHere"),
		},
		div(
			{ class: "flex items-center justify-between px-1" },
			h3({ class: "kanban-lane-title font-semibold" }, field("title")),
			span(
				{
					class: when(
						field("over"),
						"kanban-count badge badge-sm badge-error tabular-nums",
						"kanban-count badge badge-sm badge-ghost tabular-nums",
					),
				},
				field("count"),
			),
		),
		ul(
			{ class: "flex flex-col gap-2" },
			each(
				field("cards"),
				li(
					{
						class:
							"kanban-card group card card-border bg-base-100 shadow-sm cursor-grab p-2 gap-1 data-dragging:opacity-40 data-draggingover:ring-2 data-draggingover:ring-primary",
						draggable: "true",
						"data-dragtype": "card",
						"on:drop": send("dropBefore", sourceKey()),
					},
					div(
						{ class: "flex items-start gap-2" },
						span({ class: "kanban-text flex-1 text-sm break-words" }, field("text")),
						button(
							{
								class:
									"kanban-remove btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-60 hover:opacity-100",
								title: "Remove",
								"aria-label": "Remove",
								"on:click": send("removeCard", sourceKey()),
							},
							"×",
						),
					),
					button(
						{ class: lookupBind("tagClass"), title: "Change the tag", "on:click": send("cycleTag", sourceKey()) },
						field("tag"),
					),
				),
				"cards",
			),
		),
	),
};

export const register = { Kanban: "Kanban", KanbanLane: "KanbanLane" };
