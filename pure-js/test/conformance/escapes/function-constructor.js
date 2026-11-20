// @handler TodoList []
// @expect unknown-name
function (next) { Function("return this")(); }
