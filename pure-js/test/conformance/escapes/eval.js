// @handler TodoList []
// @expect unknown-name
function (next) { eval("next.text = 1"); }
