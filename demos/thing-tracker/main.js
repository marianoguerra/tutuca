import { threeWeeks } from "../../components/thing-tracker/fixtures.js";
import { trackerApp, trackerComponents } from "../../components/thing-tracker/index.js";
import { boot, browserHandlers } from "../boot.js";

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
				events: threeWeeks(),
			}),
	});

if (globalThis.document?.getElementById("app")) start();
