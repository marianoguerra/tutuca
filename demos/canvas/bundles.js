// The bundles the canvas demo can load, by ?bundle=: each is the components it registers, the
// ask handlers that tell its holes what they can become and make it, and the canvas it starts
// with. default is the notebook's components; llm the parts of an LLM request and response.
import {
	COMPOSITION_KINDS,
	canvas,
	canvasAskHandlers,
	canvasComponents,
	canvasKitComponents,
} from "../../components/canvas/index.js";
import { kindHandlers } from "../../components/canvas/layout.js";
import { LLM_KINDS, llmComponents } from "../../components/llm/index.js";

export const BUNDLES = {
	default: {
		title: "Notebook",
		components: canvasComponents,
		askHandlers: canvasAskHandlers,
		make: (C) =>
			canvas(
				C,
				[
					[48, 48, "notes"],
					[420, 120, C.Hole(), "Empty", 240],
				],
				{},
				COMPOSITION_KINDS,
			),
	},
	// A request with a tool, the call the model makes, its result and the answer, and the same
	// answer as a structured output, to explain inference with.
	llm: {
		title: "LLM inference",
		components: { ...llmComponents, ...canvasKitComponents },
		askHandlers: kindHandlers(LLM_KINDS),
		make: (C) =>
			canvas(
				C,
				[
					[48, 40, "system"],
					[48, 240, "user"],
					[48, 400, "toolCall"],
					[48, 600, "toolResult"],
					[48, 800, "assistant"],
					[540, 40, "toolDefinition"],
					[1060, 40, "structuredOutput"],
				],
				{ width: 1800, height: 1200 },
				LLM_KINDS,
			),
	},
};

// The bundle the page's ?bundle= names, or the default one.
export const bundleOf = (window) => {
	const id = window ? new URLSearchParams(window.location.search).get("bundle") : null;
	return BUNDLES[id] ?? BUNDLES.default;
};
