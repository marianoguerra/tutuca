// @handler TodoList []
// @expect reserved-name
function (next) { next.count = Math.max.call(null, 1); }
