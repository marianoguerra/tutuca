// What handlers read from the world, through ctx.now(), ctx.random() and ctx.uuid(): the
// clock in ms since the epoch, a number in [0, 1) and a new id. Each mirrors the global it
// stands for, so a host can swap them for ones that repeat (testEnv).
export const browserEnv = {
	now: () => Date.now(),
	random: () => Math.random(),
	uuid: () => globalThis.crypto.randomUUID(),
};
// An env whose runs repeat: a clock stopped at start until advance(ms) moves it, numbers from
// a generator seeded with seed, and uuid-shaped ids that count up.
export const testEnv = ({ seed = 1, start = Date.UTC(2026, 0, 1) } = {}) => {
	let time = start;
	let state = seed >>> 0;
	let ids = 0;
	return {
		now: () => time,
		advance(ms) {
			time += ms;
		},
		// mulberry32
		random() {
			state = (state + 0x6d2b79f5) >>> 0;
			let x = state;
			x = Math.imul(x ^ (x >>> 15), x | 1);
			x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
			return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
		},
		uuid: () => `00000000-0000-4000-8000-${(++ids).toString(16).padStart(12, "0")}`,
	};
};
