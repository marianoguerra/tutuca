// @handler TodoList [string]
// @expect shadowed-name
function (next, [text]) {
	if (text === "") {
		const text = "empty";
		next.text = text;
	}
}
