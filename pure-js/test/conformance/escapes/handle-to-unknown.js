// @handler TodoList []
// @expect no-matching-overload
function (next, _args, ctx) { next.text = JSON.stringify(ctx) ?? ""; }
