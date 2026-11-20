// @handler TodoList []
// @expect tagged-template
function (next) { next.text = String.raw`x`; }
