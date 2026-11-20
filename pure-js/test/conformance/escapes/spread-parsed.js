// @handler TodoList [string]
// @expect spread-type
function (next, [text]) { next.selected = { ...JSON.parse(text) }; }
