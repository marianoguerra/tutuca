// Sample tracker apps for stories, tests and the demo.
import { trackerApp } from "./index.js";
import { BUNDLES } from "./model.js";
import { DAY, HOUR, MINUTE } from "./time.js";

// Stories run at a fixed time, in UTC, so labels don't change from run to run.
export const NOW = Date.UTC(2026, 9, 16, 10, 30); // Friday 16 Oct 2026, 10:30.

// Event parts: thing ids of the bundles and measurements.
export const habit = (slug) => `thing:habits/${slug}`;
export const drink = (slug) => `thing:hydration/${slug}`;
export const mood = (slug) => `thing:mood/${slug}`;
export const km = (n) => ({ measurementId: "distance", value: n * 1000 });
export const minutes = (n) => ({ measurementId: "duration", value: n * MINUTE });
export const ml = (n) => ({ measurementId: "volume", value: n });
// A week of logging, with gaps.
const week = [
	{ thing: drink("coffee"), ago: 2 * HOUR },
	{ thing: drink("coffee"), ago: 4 * HOUR },
	{ thing: drink("water"), ago: 3 * HOUR, measurements: [ml(500)] },
	{ thing: drink("water"), ago: DAY + HOUR, measurements: [ml(250)] },
	{
		thing: habit("run"),
		ago: DAY + 2 * HOUR,
		measurements: [km(5), minutes(28)],
		notes: "Felt great",
	},
	{ thing: habit("run"), ago: 3 * DAY, measurements: [km(8), minutes(45)] },
	{ thing: habit("breakfast"), ago: 3 * DAY + HOUR },
	{ thing: habit("read"), ago: 6 * DAY, recordedAgo: 5 * DAY },
	{ thing: habit("nap"), ago: 20 * DAY, measurements: [minutes(20)] },
];
// The week at NOW; rest overrides the app's fields.
export const sample = (C, rest = {}) =>
	trackerApp(C, { now: NOW, bundles: ["habits", "hydration"], events: week, ...rest });

// Generated apps: some bundles and events among their things, at some time.
export const trackerAppArb = (A) => {
	const { fc } = A;
	const ids = BUNDLES.map((b) => b.id);
	return fc
		.record({
			bundles: fc.subarray(ids, { maxLength: 3 }),
			now: fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2027, 0, 1) }),
			tz: fc.constantFrom(0, 60, -180, 330),
			events: fc.array(
				fc.record({
					pick: fc.nat(),
					ago: fc.integer({ min: 0, max: 40 * DAY }),
					done: fc.boolean(),
				}),
				{
					maxLength: 12,
				},
			),
			compact: fc.boolean(),
			granularity: fc.constantFrom("day", "week", "month"),
		})
		.map(({ bundles, events, ...rest }) => {
			const things = BUNDLES.filter((b) => bundles.includes(b.id)).flatMap((b) => b.pack.things);
			const picked =
				things.length === 0
					? []
					: events.map((e) => ({ thing: things[e.pick % things.length].id, ago: e.ago }));
			return trackerApp(A.scope.components, { bundles, events: picked, ...rest });
		});
};

// Three weeks of logging, so insights by day, week and month have something to show.
export const threeWeeks = () => {
	const events = [];
	for (let day = 0; day < 21; day++) {
		const at = (hours) => day * DAY + hours * HOUR;
		events.push({ thing: drink("coffee"), ago: at(2) });
		if (day % 2 === 0) events.push({ thing: drink("coffee"), ago: at(6) });
		events.push({ thing: drink("water"), ago: at(3), measurements: [ml(250 + (day % 3) * 250)] });
		if (day % 3 === 0) {
			events.push({
				thing: habit("run"),
				ago: at(9),
				measurements: [km(4 + (day % 5)), minutes(25 + (day % 5) * 5)],
			});
		}
		if (day % 4 === 1) events.push({ thing: habit("read"), ago: at(13) });
		if (day % 7 === 5)
			events.push({ thing: habit("nap"), ago: at(5), measurements: [minutes(20)] });
		events.push({ thing: mood(["great", "happy", "calm", "okay", "tired"][day % 5]), ago: at(4) });
	}
	events.push({
		thing: habit("run"),
		ago: DAY + HOUR,
		measurements: [km(5), minutes(28)],
		notes: "Felt great",
	});
	return events;
};
