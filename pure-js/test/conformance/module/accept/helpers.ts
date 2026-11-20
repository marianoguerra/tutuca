// @entries {"Todos.on.*": {"this": "read State", "params": ["draft State", "[string]"], "result": "void"}, "Todos.queries.*": {"this": "read State"}}
// @run {"entry": "Todos.on.add.run", "this": {"items": [{"title": "a", "done": true}], "draft": "b"}, "args": [{"items": [{"title": "a", "done": true}], "draft": "b"}, ["c"]]}
export type Task = { title: string; done: boolean };
export type State = { items: Task[]; draft: string };

function open(xs: Readonly<Task[]>): number {
	let n = 0;
	for (const x of xs) {
		if (x.done) continue;
		n += 1;
	}
	return n;
}
function made(title: string): Task {
	return { title, done: false };
}
function titles(xs: Readonly<Task[]>): string[] {
	return xs.map((x) => x.title);
}

export const Todos = {
	queries: {
		get left(): number {
			return open(this.items);
		},
	},
	on: {
		add: {
			run(next, [text]) {
				const item = made(this.draft + text);
				item.done = open(this.items) > 3;
				next.items.push(item);
				const all = titles(next.items);
				all.push("end");
				next.draft = all.join(",");
			},
		},
	},
};
