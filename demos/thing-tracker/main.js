import { trackerApp, trackerComponents } from "../../components/thing-tracker/index.js";
import { DAY, HOUR, MINUTE } from "../../components/thing-tracker/time.js";
import { boot, browserHandlers } from "../boot.js";

const habit = (slug) => `thing:habits/${slug}`;
const drink = (slug) => `thing:hydration/${slug}`;
const mood = (slug) => `thing:mood/${slug}`;
const km = (n) => ({ measurementId: "distance", value: n * 1000 });
const minutes = (n) => ({ measurementId: "duration", value: n * MINUTE });
const ml = (n) => ({ measurementId: "volume", value: n });

// Three weeks of logging, so insights by day, week and month have something to show.
const history = () => {
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

export const start = (document = globalThis.document, now = Date.now()) =>
	boot({
		document,
		components: trackerComponents,
		askHandlers: {
			now: browserHandlers.now,
			wait: browserHandlers.wait,
			saveFile: browserHandlers.saveFile,
			readText: browserHandlers.readText,
		},
		make: (C) =>
			trackerApp(C, {
				now,
				tz: -new Date(now).getTimezoneOffset(),
				bundles: ["habits", "hydration", "mood"],
				events: history(),
			}),
	});

if (globalThis.document?.getElementById("app")) start();
