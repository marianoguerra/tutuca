// @handler TodoList []
// @expect wrong-arity
function (next) { next.count = Math.floor(); }
