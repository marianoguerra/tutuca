// @entries {"B.on.*": {"this": "read State", "params": ["draft State", "[number]"], "result": "void"}}
// @run {"entry": "B.on.tag.run", "this": {"cards": [{"tags": ["a"]}]}, "args": [{"cards": [{"tags": ["a"]}]}, [0]]}
export type Card = { tags: string[] };
export type State = { cards: Card[] };
export const B = {
	on: {
		tag: {
			run(next, [at]) {
				const card = next.cards[at];
				if (card === undefined) return;
				card.tags.push("b");
				const tags = card.tags;
				tags.push(`${tags.length}`);
				const all = next.cards.map((c) => c.tags.length);
				next.cards.push({ tags: all.map((n) => `${n}`) });
			},
		},
	},
};
