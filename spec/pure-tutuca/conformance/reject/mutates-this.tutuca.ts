// @expect immutable-target
export type Flag = { on: boolean };
export const Flag = {
	defaults: { on: false },
	on: {
		toggle: {
			run(next) {
				this.on = !this.on;
			},
		},
	},
};
