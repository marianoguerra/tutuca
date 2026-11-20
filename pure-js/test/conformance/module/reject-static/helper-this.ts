// @expect helper-this
export type State = { n: number };
function twice(this: Readonly<State>): number {
	return this.n * 2;
}
