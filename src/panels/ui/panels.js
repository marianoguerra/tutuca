// The panels of a story's app, shared by the storybook and the playground: the steps, the
// stress test and the dev panel, fed by the reports of its <tutuca-app>.
import { devComponents, makeDevPanel } from "../../dev/panel.js";
import { apply, field, scopeOf, send, t, tag } from "../../tutuca.js";
import { StoryPanel, SUMMARY_KEYS } from "./story-panel.js";
import { StressPanel, stressResult } from "./stress-panel.js";

// The panels' components.
export const panelComponents = { StoryPanel, StressPanel, ...devComponents };

// The panel fields of a component that shows them, and new panels for the app at appKey.
export const panelFields = {
	story: t.component("StoryPanel"),
	stress: t.component("StressPanel"),
	dev: t.component("DevPanel"),
};
export const makePanels = (C, appKey = "") => ({
	story: C.StoryPanel({ appKey }),
	stress: C.StressPanel({ appKey }),
	dev: makeDevPanel(C),
});
// queries with isSteps, isStress and isDev, which say whether the field named shown says
// that panel shows.
export const withPanelQueries = (shown, queries) =>
	Object.defineProperties(queries, {
		isSteps: { get: getter(shown, "steps"), enumerable: true },
		isStress: { get: getter(shown, "stress"), enumerable: true },
		isDev: { get: getter(shown, "dev"), enumerable: true },
	});
const getter = (shown, panel) =>
	function () {
		return this[shown] === panel;
	};
// The handlers the panels send their parent: showSteps sets the field named shown to "steps",
// appReport applies a report of the story's app (see applyAppReport).
export const panelHandlers = (shown) => ({
	showSteps(next, _args, ctx) {
		next[shown] = "steps";
		ctx.stopNext();
	},
	appReport(next, _args, ctx) {
		applyAppReport(this, next, ctx.event?.detail);
	},
});
// The <tutuca-app> of the story at the appKey query, reporting to appReport.
export const storyApp = () =>
	tag["tutuca-app"]({
		class: "block",
		"app-key": field("appKey"),
		"on:tutucareport": send("appReport"),
	});
// New panels in next for the app it now shows, next.appKey.
export const resetPanels = (self, next) => {
	Object.assign(next, makePanels(scopeOf(self).components, next.appKey));
};

// Applies a tutucareport of self's app (self.appKey) to the panels; reports of other apps,
// like one being replaced, are ignored.
export const applyAppReport = (self, next, detail) => {
	if (detail?.key !== self.appKey) return;
	if (detail.type === "state" && next.story.appKey === detail.key) {
		const summary = Object.fromEntries(SUMMARY_KEYS.map((key) => [key, detail.data[key]]));
		next.story = apply(next.story, "showSummary", summary);
		if (detail.data.dev) next.dev = apply(next.dev, "showApp", detail.data.dev);
	} else if (detail.type === "stress" && next.stress.status === "running") {
		next.stress = apply(next.stress, "showStress", stressResult(detail.data));
	}
};
