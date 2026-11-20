// @handler TodoList []
// @expect not-assignable
function (next, _args, ctx) { next.selected = ctx; }
