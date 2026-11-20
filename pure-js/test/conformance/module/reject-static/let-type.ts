// @expect not-assignable
function f(xs: Readonly<string[]>): number {
	let n = 0;
	for (const x of xs) n = x;
	return n;
}
export const N = { start: 1 };
