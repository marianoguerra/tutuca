// @expect not-assignable
export type Named = { name: string };
export const Named = {
	defaults: { name: 3 },
	on: {},
};
