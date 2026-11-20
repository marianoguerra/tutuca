// @handler TodoList [unknown]
// @expect spread-type
function (next, [x]) { next.selected = { ...x }; }
