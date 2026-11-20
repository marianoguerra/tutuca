// @expect namespace-as-value
function size(x: unknown): number {
	return typeof x === "object" ? 1 : 0;
}
export const Ns = {
	n: 1,
	get two(): number {
		return 2;
	},
};
const S = size(Ns);
