// @handler TodoList []
// @expect comparison-type
function (next) {
	next.filter = "open";
	if (next.filter === "done") next.count = 0;
}
