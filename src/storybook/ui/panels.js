// The panels of a story's app, shared by the storybook and the playground: the steps, the
// stress test and the dev panel, fed by the reports of its <tutuca-app>.
import { devClasses, devComponents, makeDevPanel, updateDevPanel } from "../../dev/panel.js";
import { scopeOf } from "../../tutuca.js";
import { BADGES } from "./common.js";
import { StoryPanel, SUMMARY_KEYS, syncForm } from "./story-panel.js";
import { applyStress, StressPanel } from "./stress-panel.js";

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
		for (const key of SUMMARY_KEYS) next.story[key] = detail.data[key];
		syncForm(next.story);
		if (detail.data.dev) updateDevPanel(scopeOf(self).components, next.dev, detail.data.dev);
	} else if (detail.type === "stress" && next.stress.status === "running") {
		applyStress(next.stress, detail.data);
	}
};
