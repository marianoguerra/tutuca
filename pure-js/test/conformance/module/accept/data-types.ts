// @data {"Shelf.defaults": "{ books?: string[]; size?: number }", "Plain.defaults": "{ tags?: string[] }"}
// @entries {"Shelf.queries.*": {"this": "read State"}}
// @run {"entry": "Shelf.queries.count", "this": {"books": ["a"], "size": 1}, "args": []}
export type State = { books: string[]; size: number };
export const Shelf = {
	defaults: { books: [], size: 0 },
	queries: {
		count(): number {
			return this.books.length + Plain.label.length;
		},
	},
};
export const Plain = { defaults: { tags: [] }, label: "plain" };
