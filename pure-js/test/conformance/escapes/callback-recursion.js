// @handler TodoList []
// @expect arrow-not-callback
function (next) {
	const loop = (f) => f(f);
	loop(loop);
}
