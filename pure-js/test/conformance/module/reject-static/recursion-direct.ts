// @expect recursive-call
function down(n: number): number {
	return n <= 0 ? 0 : down(n - 1);
}
export const N = { start: 1 };
