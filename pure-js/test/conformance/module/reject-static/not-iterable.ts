// @expect not-iterable
function keys(d: Readonly<{ [key: string]: number }>): number {
	let n = 0;
	for (const k of d) n += 1;
	return n;
}
export const N = { start: 1 };
