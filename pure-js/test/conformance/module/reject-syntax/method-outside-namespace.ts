// @expect object-method
function f(): number {
	const o = { g() { return 1; } };
	return 1;
}
