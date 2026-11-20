// @expect argument-type
export type Pinger = { n: number };
export interface PingerNotifies {
	pinged(): void;
}
export const Pinger = {
	on: {
		ping: {
			run(next, [], ctx) {
				ctx.notify("pong", []);
			},
		},
	},
};
