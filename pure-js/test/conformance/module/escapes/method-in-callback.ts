// @expect object-method
function f(xs: Readonly<number[]>): number {
	return xs.map((x) => ({ valueOf() { return x; } })).length;
}
