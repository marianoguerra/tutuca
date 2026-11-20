// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
add(next, _args, ctx) {
	const text = this.text.trim();
	if (text === "") return;
	next.items.push({ title: text, done: false });
	next.text = "";
	ctx.notify("changed", [text]);
}
