// @expect const-cycle
export const N = { size: count() };
function count(): number {
	return N.size + 1;
}
