// @expect recursive-call
function even(n: number): boolean {
	return n === 0 ? true : odd(n - 1);
}
function odd(n: number): boolean {
	return n === 0 ? false : even(n - 1);
}
export const N = { start: 1 };
