// @handler TodoList []
// @expect unknown-name
function (next) { next.count = arguments.length; }
