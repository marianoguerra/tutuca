// @handler TodoList []
// @expect reserved-name
function (next) { next.tags = { toString: 1 }; }
