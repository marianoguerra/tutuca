// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	const kept: Item[] = [];
	kept.push(...this.items.filter((it) => !it.done));
	next.items = kept;
}
