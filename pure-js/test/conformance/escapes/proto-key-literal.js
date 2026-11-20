// @handler TodoList []
// @expect reserved-name
function (next) { next.tags = { __proto__: null }; }
