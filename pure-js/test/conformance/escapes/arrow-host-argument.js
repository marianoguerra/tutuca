// @handler TodoList []
// @expect arrow-not-callback
function (next, _args, ctx) { ctx.notify("changed", [Number.isInteger((x) => x)]); }
