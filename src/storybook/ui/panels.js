// The panels of a story's app, shared by the storybook and the playground: the steps, the
// stress test and the dev panel, fed by the reports of its <tutuca-app>.
import { devClasses, devComponents, makeDevPanel } from "../../dev/panel.js";
import { apply, scopeOf } from "../../tutuca.js";
import { BADGES } from "./common.js";
import { StoryPanel, SUMMARY_KEYS } from "./story-panel.js";
import { StressPanel, stressResult } from "./stress-panel.js";

// The panels' components, and the class names they build at runtime.
export const panelComponents = { StoryPanel, StressPanel, ...devComponents };
export const panelClassNames = [...Object.values(BADGES), ...devClasses];

// New panels for the app at appKey, in next's story, stress and dev fields.
export const resetPanels = (self, next, appKey) => {
	const C = scopeOf(self).components;
	next.story = C.StoryPanel({ appKey });
	next.stress = C.StressPanel({ appKey });
	next.dev = makeDevPanel(C);
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
