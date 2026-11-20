// @handler TodoList []
// @expect argument-type
function (next, _args, ctx) { ctx.notify("deleted", []); }
