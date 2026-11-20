// @handler TodoList []
// @expect unreachable-code
function (next) { return; next.count = 1; }
