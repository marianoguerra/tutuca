// @entries {"Tags.queries.*": {"this": "read State"}}
// @run {"entry": "Tags.queries.next", "this": {"tag": "bug", "card": {"tag": "chore"}}, "args": []}
// A string union named by an alias is its members: === against one is a comparison that can be
// true, and a value of it, read-only or not, goes to a helper that takes it, as strings can't
// change.
export type Tag = "feature" | "bug" | "chore";
export type State = { tag: Tag; card: { tag: Tag } };
function after(tag: Tag): Tag {
	if (tag === "feature") return "bug";
	if (tag === "bug") return "chore";
	return "feature";
}
export const Tags = {
	queries: {
		next(): Tag[] {
			return [after(this.tag), after(this.card.tag)];
		},
	},
};
