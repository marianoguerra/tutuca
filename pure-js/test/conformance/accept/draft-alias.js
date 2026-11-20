// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	const first = next.items[0];
	if (first === undefined) return;
	first.title = first.title.toUpperCase();
	next.selected = { title: first.title, done: first.done };
}
