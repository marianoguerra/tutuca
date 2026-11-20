// @handler TodoList []
// @expect reserved-name
function (next, _args, ctx) { ctx.notify.bind(null); }
