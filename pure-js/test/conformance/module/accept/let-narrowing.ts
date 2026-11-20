// @entries {"Words.queries.*": {"this": "read State"}}
// @run {"entry": "Words.queries.longest", "this": {"words": ["a", "abc", "ab"]}, "args": []}
export type State = { words: string[] };

function longest(words: Readonly<string[]>): string {
	let best: string | null = null;
	for (const w of words) {
		if (best === null || w.length > best.length) best = w;
	}
	return best ?? "";
}

export const Words = {
	queries: {
		longest(): string {
			return longest(this.words);
		},
	},
};
