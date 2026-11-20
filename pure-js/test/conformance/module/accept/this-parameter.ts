// @run {"entry": "Tally.add", "this": {"total": 1}, "args": [{"total": 1}, 4]}
export type State = { total: number };

export const Tally = {
	add(this: Readonly<State>, next: State, n: number): void {
		next.total = this.total + n;
	},
};
