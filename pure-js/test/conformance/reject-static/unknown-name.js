// @handler TodoList []
// @expect unknown-name
function (next) { next.text = window.name; }
