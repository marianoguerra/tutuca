// A page's host module (spec/pure-tutuca/host/words.json): its calls are checked as any host's,
// and what it returns is checked against the declared type, since the page isn't trusted.

import { boom, count, lie, split, stats } from "tutuca/test/words";
import { div } from "tutuca/view";

export type Words = { text: string; words: string[]; n: number; longest: string; note: string };

export const Words = {
	defaults: { text: "", words: [], n: 0, longest: "", note: "" },
	on: {
		read: {
			pure: true,
			run(next, [text]: [string]) {
				next.text = text;
				next.words = split(text).filter((w) => w !== "");
				next.n = count(text, "the");
				const s = stats(text);
				next.longest = s.longest;
				next.note = s.first ?? "(none)";
			},
		},
		lie: {
			pure: true,
			run(next) {
				next.note = lie();
			},
		},
		boom: {
			pure: true,
			run(next) {
				next.note = boom();
			},
		},
	},
	view: div({}),
};
