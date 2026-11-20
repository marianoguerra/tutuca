// @handler TodoList []
// @expect identifier-escape
function (next) { next.text = this.\u0063onstructor; }
