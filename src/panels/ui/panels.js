// The panels of a story's app, shared by the storybook and the playground: the steps, the
// stress test and the dev panel, fed by the reports of its <tutuca-app>.

import { $if, apply, field, render, scopeOf, send, t, tag } from "../../tutuca.js";
import { isShown } from "./common.js";
import { devComponents, makeDevPanel } from "./dev-panel.js";
import { StoryPanel, SUMMARY_KEYS } from "./story-panel.js";
import { StressPanel, stressResult } from "./stress-panel.js";

// The panels' components.
export const panelComponents = { StoryPanel, StressPanel, ...devComponents };

// The panels, by the name a component's panel field shows each by: its tab's label and the
// field it is in.
const PANEL_FIELDS = { steps: "story", stress: "stress", dev: "dev" };
export const PANEL_LABELS = { steps: "Steps", stress: "Stress test", dev: "Dev" };
export const PANELS = Object.keys(PANEL_LABELS);
// The panel fields of a component that shows them (besides panel, which says the one shown,
// one of PANELS among whatever else it shows), and new panels for the app at appKey.
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
// queries with isSteps, isStress and isDev, which say whether the panel field says that panel
// shows.
export const withPanelQueries = (queries) =>
	Object.defineProperties(
		queries,
		Object.fromEntries(
			PANELS.map((panel) => [
				isShown(panel),
				{
					get() {
						return this.panel === panel;
					},
					enumerable: true,
				},
			]),
		),
	);
// The panel that shows, of the three.
export const panelsView = () =>
	PANELS.map((panel) => $if(field(isShown(panel)), render(field(PANEL_FIELDS[panel])), ""));
// The handlers the panels send their parent: showSteps shows the steps, appReport applies a
// report of the story's app (see applyAppReport).
export const panelHandlers = (onState = null) => ({
	showSteps(next, _args, ctx) {
		next.panel = "steps";
		ctx.stopNext();
	},
	appReport(next, _args, ctx) {
		applyAppReport(this, next, ctx.event?.detail, onState);
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
// like one being replaced, are ignored. onState(self, next, data) gets a state report's data
// too, for what else self shows of it.
const applyAppReport = (self, next, detail, onState) => {
	if (detail?.key !== self.appKey) return;
	if (detail.type === "state" && next.story.appKey === detail.key) {
		onState?.(self, next, detail.data);
		const summary = Object.fromEntries(SUMMARY_KEYS.map((key) => [key, detail.data[key]]));
		next.story = apply(next.story, "showSummary", summary);
		if (detail.data.dev) next.dev = apply(next.dev, "showApp", detail.data.dev);
		if (detail.data.stress) next.stress = apply(next.stress, "showSettings", detail.data.stress);
	} else if (detail.type === "stress" && next.stress.status === "running") {
		next.stress = apply(next.stress, "showStress", stressResult(detail.data));
	}
};
