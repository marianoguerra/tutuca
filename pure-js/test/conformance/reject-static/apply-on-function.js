// @handler TodoList []
// @expect reserved-name
function (next) { next.count = Math.max.apply(null, [1]); }
