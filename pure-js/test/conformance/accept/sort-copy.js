// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.items = this.items.slice().sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}
