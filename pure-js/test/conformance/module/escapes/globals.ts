// @expect unknown-name
function f(): number {
	return globalThis.location === undefined ? 1 : 0;
}
