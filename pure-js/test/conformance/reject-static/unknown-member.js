// @handler TodoList [unknown]
// @expect unknown-member
function (next, [x]) { next.text = x.name; }
