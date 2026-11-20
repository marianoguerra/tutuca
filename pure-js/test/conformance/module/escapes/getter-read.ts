// @expect entry-access
export const N = {
	get secret(): number {
		return 1;
	},
};
const S = N.secret;
