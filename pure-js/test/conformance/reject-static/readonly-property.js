// @handler TodoList []
// @expect readonly-property
function (next) { next.left = 0; }
