// @handler Drawing [number]
// @run {"this": "@drawing", "args": ["@draft-drawing", [0], "@ctx"]}
function (next, [i]) {
	const s = this.shapes[i];
	if (s === undefined) return;
	next.total = s.kind === "circle" ? s.r * s.r * 3 : s.side * s.side;
}
