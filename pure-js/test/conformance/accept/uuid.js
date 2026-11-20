// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next, _args, ctx) {
	next.text = ctx.uuid();
}
