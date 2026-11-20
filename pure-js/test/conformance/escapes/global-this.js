// @handler TodoList []
// @expect unknown-name
function (next) { next.text = globalThis.name; }
