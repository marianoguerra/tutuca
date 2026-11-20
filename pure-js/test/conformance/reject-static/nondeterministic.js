// @handler TodoList []
// @deterministic
// @expect nondeterministic-call
function (next, _args, ctx) { next.text = ctx.uuid(); }
