// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["ship"], "@ctx"]}
function (next, [title]) {
	const titles = this.items.map((it) => it.title);
	next.count = titles.includes(title) ? titles.indexOf(title) : -1;
}
