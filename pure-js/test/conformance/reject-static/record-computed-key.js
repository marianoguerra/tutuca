// @handler TodoList [string]
// @expect record-computed-key
function (next, [k]) { next[k] = 1; }
