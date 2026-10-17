// The panels of a story's app, shared by the storybook and the playground: the steps, the
// stress test and the dev panel, fed by the reports of its <tutuca-app>.
import { makeDevPanel, updateDevPanel } from "../../dev/panel.js";
import { scopeOf } from "../../tutuca.js";
import { SUMMARY_KEYS, syncForm } from "./story-panel.js";
import { applyStress } from "./stress-panel.js";

// New panels for the app at appKey, in draft's story, stress and dev fields.
export const resetPanels = (self, draft, appKey) => {
	const C = scopeOf(self).components;
	draft.story = C.StoryPanel({ appKey });
	draft.stress = C.StressPanel({ appKey });
	draft.dev = makeDevPanel(C);
};

// Applies a tutucareport of self's app (self.appKey) to the panels; reports of other apps,
// like one being replaced, are ignored.
export const applyAppReport = (self, draft, detail) => {
	if (detail?.key !== self.appKey) return;
	if (detail.type === "state" && draft.story.appKey === detail.key) {
		for (const key of SUMMARY_KEYS) draft.story[key] = detail.data[key];
		syncForm(draft.story);
		if (detail.data.dev) updateDevPanel(scopeOf(self).components, draft.dev, detail.data.dev);
	} else if (detail.type === "stress" && draft.stress.status === "running") {
		applyStress(draft.stress, detail.data);
	}
};
