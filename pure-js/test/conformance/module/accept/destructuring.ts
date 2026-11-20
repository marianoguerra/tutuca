// @entries {"Board.on.*": {"this": "read State", "params": ["draft State", "[string, number]"], "result": "void"}}
// @run {"entry": "Board.on.rename.run", "this": {"cards": [{"id": 1, "title": "a", "tags": ["x"]}], "title": "t"}, "args": [{"cards": [{"id": 1, "title": "a", "tags": ["x"]}], "title": "t"}, ["b", 0]]}
export type Card = { id: number; title: string; tags: string[]; note?: string };
export type State = { cards: Card[]; title: string };

export const Board = {
	on: {
		rename: {
			run(next, [title, at]) {
				const { cards } = next;
				const card = cards[at];
				if (card === undefined) return;
				const { tags, note = "none", ...rest } = card;
				const [first, ...others] = tags;
				tags.push(`${rest.title}:${note}:${first ?? ""}:${others.length}`);
				card.title = title;
				next.title = `${rest.id}`;
			},
		},
	},
};
