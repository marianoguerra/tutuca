// @handler TodoList []
// @expect callback-arity
function (next) { next.count = this.items.filter((a, b, c) => a.done).length; }
