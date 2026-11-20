// @entries {"Notes.queries.*": {"this": "read State"}}
// @run {"entry": "Notes.queries.summary", "this": {"notes": [{"text": "a"}, {"text": "b", "tag": "x"}]}, "args": []}
export type Note = { text: string; tag?: string };
export type State = { notes: Note[] };

function label(n: Readonly<Note>): string {
	if (n.tag === undefined) return n.text;
	return `${n.text}#${n.tag}`;
}

export const Notes = {
	queries: {
		summary(): string {
			return this.notes.map((n) => label(n)).join(" ");
		},
	},
};
