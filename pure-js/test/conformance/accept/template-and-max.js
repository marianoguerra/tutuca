// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	const widest = Math.max(0, ...this.items.map((it) => it.title.length));
	next.text = `${widest} wide, ${this.left} left`;
}
