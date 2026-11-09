import { withSample } from "../../src/meta/index.js";
import { book, step } from "../../src/storybook/index.js";
import { canvas, canvasKitComponents } from "../canvas/index.js";

const markdown = (C, sample) => withSample(C.Markdown({}), sample);
// The markdown document on the canvas the story makes.
const doc = (s) => s.items["item-1"].content;

export default book({
	title: "Markdown",
	components: canvasKitComponents,
	stories: {
		Empty: { make: (C) => C.Markdown({}) },
		Readme: { make: (C) => markdown(C, "readme") },
		Notes: { make: (C) => markdown(C, "notes") },
		// Its edit view shows on a canvas, which pushes it while its item's ✎ is on.
		"On a canvas": {
			make: (C) =>
				canvas(
					C,
					[[24, 24, markdown(C, "notes"), "📄 Notes", 640]],
					{ width: 720, height: 520 },
					{},
				),
			sequences: {
				"edit it: the textarea writes it, the preview beside it shows it": [
					step.event("click", '[aria-label="Edit it"]'),
					step.event("input", 'textarea[aria-label="Markdown"]', { value: "# Written\n\n- here" }),
					step.check("written", (s) => doc(s).text === "# Written\n\n- here"),
					step.event("click", '[aria-label="Use it"]'),
					step.check("still written", (s) => doc(s).text.startsWith("# Written")),
				],
			},
		},
	},
});
