// @handler Drawing []
// @run {"this": "@drawing", "args": ["@draft-drawing", [], "@ctx"]}
function (next) {
	const s = this.shapes.at(-1);
	if (s === undefined) return;
	if (s.kind === "square") {
		next.label = `square of ${s.side}`;
		return;
	}
	next.label = `circle of ${s.r}`;
}
