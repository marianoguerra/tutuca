// @handler TodoList []
// @expect unknown-type
function (next) { const x: Thing = 1; }
