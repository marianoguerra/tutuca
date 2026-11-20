// The showcase component module: Shelf and Note, using what the other examples' views don't: a
// scope's binds, a loop with filter, enrich and key hooks, a loop with prepare and iter hooks,
// seq items, a float, a provided value, pushView, renderIt, and drag and drop.
import type { Display, Classes } from "../meta/meta.tutuca";
import {
	button,
	dd,
	dl,
	dragKey,
	dt,
	each,
	field,
	h2,
	li,
	lookupBind,
	p,
	progress,
	provided,
	pushView,
	render,
	renderIt,
	section,
	send,
	seqItem,
	small,
	sourceKey,
	span,
	ul,
	when,
	withBinds,
} from "tutuca/view";
import { range } from "tutuca/data";

export type Book = { title: string; year: number; read: boolean };

/** The year of the book at i (0 past the end). */
function yearAt(books: readonly Book[], i: number): number {
	const book = books[i];
	return book === undefined ? 0 : book.year;
}

/** How many of the books are read. */
function readCount(books: readonly Book[]): number {
	return books.filter((b) => b.read).length;
}

/**
 * A shelf of books. The books loop keeps only the unread ones when onlyUnread, keys them by
 * title, and binds label as "title (year)"; the byYear loop's prepare sorts their indexes by
 * year, and its iter gives the books in that order. A book dropped on another moves there;
 * dropped on a note, which handles no drop, it reaches the notes' on:drop, which sends that
 * note the book's title.
 */
export type Shelf = {
	books: Book[];
	onlyUnread: boolean;
	tags: string[];
	current: number;
	theme: string;
	note: Note | null;
	notes: Note[];
	/** The share of the books read. */
	readonly share: number;
	/** "1 of 3 read". */
	readonly readText: string;
};

export const Shelf = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Shelf",
			icon: "📚",
			description: "Books sorted by year, dragged to reorder, and notes about them.",
		},
	},
	defaults: { books: [], onlyUnread: false, tags: [], current: 0, theme: "", note: null, notes: [] },
	constraints: { current: { int: true }, share: { min: 0, max: 1 } },
	queries: {
		get share(): number {
			return this.books.length === 0 ? 0 : readCount(this.books) / this.books.length;
		},
		get readText(): string {
			return `${readCount(this.books)} of ${this.books.length} read`;
		},
	},
	provides: { theme: "theme" },
	on: {
		toggleUnread: {
			pure: true,
			changes: ["onlyUnread"],
			post(prev, next, []: []) {
				return next.onlyUnread === !prev.onlyUnread;
			},
			run(next, []: []) {
				next.onlyUnread = !this.onlyUnread;
			},
		},
		/**
		 * The book dragged from from, dropped on the one at to; a drag from elsewhere has no key,
		 * and nothing moves. It logs what's dragged.
		 */
		moveBook: {
			changes: ["books"],
			constraints: { from: { keyOf: "books" }, to: { keyOf: "books" } },
			post(prev, next, [from, to]: [number | null, number | null]) {
				return next.books.length === prev.books.length;
			},
			run(next, [from, to]: [number | null, number | null], ctx) {
				ctx.log(ctx.drag);
				if (from === null || to === null || from === to) return;
				const moved = this.books[from];
				if (moved === undefined) return;
				next.books.splice(from, 1);
				next.books.splice(to, 0, moved);
			},
		},
		/** A book dropped on a note writes its title there. */
		noteBook: {
			changes: [],
			constraints: { book: { keyOf: "books" }, note: { keyOf: "notes" } },
			run(next, [book, note]: [number | null, number | null], ctx) {
				if (book === null || note === null) return;
				const dropped = this.books[book];
				if (dropped === undefined) return;
				ctx.sendAt("setText", [dropped.title], { item: "notes", key: note });
			},
		},
	},
	binds: {
		header() {
			return { heading: `${this.books.length} books` };
		},
	},
	loops: {
		books: {
			key(key: number, item: Book): string {
				return item.title;
			},
			filter(key: number, item: Book): boolean {
				return !this.onlyUnread || !item.read;
			},
			enrich(key: number, item: Book) {
				return { label: `${item.title} (${item.year})` };
			},
		},
		byYear: {
			/** The books' indexes, by year. */
			prepare(items: Book[]): number[] {
				return range(0, items.length).sort((a, b) => yearAt(items, a) - yearAt(items, b));
			},
			/** [index, book] in the order prepare sorted. */
			iter(items: Book[], order: number[]): [number, Book][] {
				const out: [number, Book][] = [];
				for (const at of order) {
					const book = items[at];
					if (book !== undefined) out.push([at, book]);
				}
				return out;
			},
		},
	},
	// Each row of the list says what it shows.
	view: section(
		{ class: "shelf card card-border bg-base-100 gap-3 p-4" },
		withBinds("header", h2({ class: "card-title" }, lookupBind("heading"))),
		dl(
			{ class: "grid grid-cols-[8rem_1fr] gap-x-3 gap-y-3 items-center text-sm" },
			dt({ class: "opacity-60" }, "Books"),
			dd(
				{ class: "flex flex-col gap-1" },
				button(
					{ class: "btn btn-xs btn-outline w-fit", "on:click": send("toggleUnread") },
					when(field("onlyUnread"), "show all", "only unread"),
				),
				ul(
					{ class: "flex flex-wrap gap-1" },
					each(
						field("books"),
						li(
							{
								class: when(
									field("read"),
									"read badge badge-success cursor-grab",
									"unread badge badge-outline cursor-grab",
								),
								title: "drag onto another book to move it there, or onto a note",
								draggable: "true",
								"data-dragtype": "book",
								"on:drop": send("moveBook", dragKey(), sourceKey()),
							},
							lookupBind("label"),
						),
						"books",
					),
				),
				span({ class: "text-xs opacity-60" }, "green: read. Drag a book onto another to reorder."),
			),
			dt({ class: "opacity-60" }, "Oldest first"),
			dd(
				{ class: "by-year flex flex-wrap gap-1" },
				each(field("books"), span({ class: "badge badge-ghost" }, field("title")), "byYear"),
			),
			dt({ class: "opacity-60" }, "Current tag"),
			dd({}, p({ class: "tag badge badge-primary" }, seqItem("tags", "current"))),
			dt({ class: "opacity-60" }, "Read"),
			dd(
				{ class: "flex items-center gap-2" },
				progress({ class: "progress progress-success w-32", max: "1", value: field("share") }),
				span({ class: "tabular-nums" }, field("readText")),
			),
			dt({ class: "opacity-60" }, "Pinned note"),
			dd({}, pushView("compact", render(field("note")))),
			dt({ class: "opacity-60" }, "Notes"),
			dd(
				{ class: "notes flex flex-col gap-1", "on:drop": send("noteBook", dragKey(), sourceKey()) },
				each(field("notes"), renderIt()),
				span({ class: "text-xs opacity-60" }, "Drop a book on a note to write its title there."),
			),
		),
	),
};

/** A note: its text, in a paragraph, or small in the provided theme, whose classes it lists for the CSS compiler. */
export type Note = { text: string };

export const Note = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Note", icon: "📝", description: "A note's text." },
		"https://tutuca.dev/meta/classes": { classes: "dark light" },
	},
	defaults: { text: "" },
	on: {
		setText: {
			pure: true,
			changes: ["text"],
			post(prev, next, [text]: [string]) {
				return next.text === text;
			},
			run(next, [text]: [string]) {
				next.text = text;
			},
		},
	},
	view: p({ class: "note text-sm rounded-box border border-dashed border-base-300 px-2 py-1" }, field("text")),
	views: {
		compact: small({ class: provided("theme") }, field("text")),
	},
};
