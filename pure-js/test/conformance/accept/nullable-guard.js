// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	const selected = this.selected;
	if (selected === null) return;
	next.text = selected.title;
}
