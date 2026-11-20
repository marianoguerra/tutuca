// @handler TodoList []
// @expect no-matching-overload
function (next) { next.text = JSON.stringify(1, 2, 3) ?? ""; }
