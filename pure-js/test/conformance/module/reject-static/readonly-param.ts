// @expect immutable-target
export type Task = { done: boolean };
function finish(xs: Readonly<Task[]>): void {
	xs.push({ done: true });
}
export const N = { start: 1 };
