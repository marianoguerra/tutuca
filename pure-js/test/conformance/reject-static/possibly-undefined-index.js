// @handler TodoList [number]
// @expect possibly-null
function (next, [i]) { next.items[i].done = true; }
