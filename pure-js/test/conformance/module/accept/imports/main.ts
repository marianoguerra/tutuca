// @entries {"Shelf.queries.*": {"this": "read State"}}
// @run {"entry": "Shelf.queries.count", "this": {"books": [{"title": "a", "read": true}, {"title": "b", "read": false}]}, "args": []}
import type { Book } from "./books";
import { unread } from "./books";

export type State = { books: Book[] };

export const Shelf = {
	queries: {
		count(): string {
			return `${unread(this.books)} of ${this.books.length}`;
		},
	},
};
