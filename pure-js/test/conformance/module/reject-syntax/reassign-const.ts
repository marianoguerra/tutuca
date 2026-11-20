// @expect reassignment
function f(n: number): number {
	const m = n;
	m = 2;
	return m;
}
