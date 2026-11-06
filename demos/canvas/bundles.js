// The bundles the canvas demo can load, by ?bundle= (and ?agent, any of them in an agent: see
// withAgent): each is the components it registers, the
// meta schemas it checks them against, the ask handlers that tell its holes what they can
// become and make it, and the canvas it starts with. default is the notebook's components; llm
// the parts of an LLM request and response; http an HTTP exchange and the OpenAPI operation it
// follows; music the circle of fifths, intervals, chords, scales and a piano.

import {
	COMPOSITION_KINDS,
	canvas,
	canvasAskHandlers,
	canvasComponents,
	canvasKitComponents,
	canvasMetaSchemas,
	withAssistant,
} from "../../components/canvas/index.js";
import { kindHandlers } from "../../components/canvas/layout.js";
import { HTTP_KINDS, httpComponents } from "../../components/http/index.js";
import { kanbanComponents } from "../../components/kanban/index.js";
import { LLM_KINDS, llmComponents } from "../../components/llm/index.js";
import { MUSIC_KINDS, musicComponents } from "../../components/music/index.js";
import { agentMetaSchemas, withSample } from "../../src/tutuca.js";

// What the agent bundle's holes can become: the notebook's, and a board, which an agent can
// drive as it can most of the notebook's.
const AGENT_KINDS = {
	...COMPOSITION_KINDS,
	board: { component: "Board", make: (C) => C.Board({}) },
};
export const BUNDLES = {
	default: {
		title: "Notebook",
		components: canvasComponents,
		askHandlers: canvasAskHandlers,
		metaSchemas: canvasMetaSchemas,
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
		metaSchemas: canvasMetaSchemas,
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
	// A web page reading a task from an API: the request, its response and the operation they
	// follow, apart, and the exchange that checks them against it, to explain HTTP with.
	http: {
		title: "HTTP & OpenAPI",
		components: { ...httpComponents, ...canvasKitComponents },
		askHandlers: kindHandlers(HTTP_KINDS),
		metaSchemas: canvasMetaSchemas,
		make: (C) =>
			canvas(
				C,
				[
					[48, 40, "request"],
					[48, 560, "response"],
					[580, 40, "operation"],
					[1150, 40, "exchange"],
				],
				{ width: 1800, height: 1400 },
				HTTP_KINDS,
			),
	},
	// The circle of fifths, an interval picker, a chord explorer, a piano and a guitar's neck to
	// mark notes on, an explorer of a note or chord moved by an interval offset and a scale
	// explorer that shows a scale on both.
	music: {
		title: "Music theory",
		components: { ...musicComponents, ...canvasKitComponents },
		askHandlers: kindHandlers(MUSIC_KINDS),
		metaSchemas: canvasMetaSchemas,
		make: (C) =>
			canvas(
				C,
				[
					[48, 40, "circle"],
					[500, 40, "chords"],
					[1080, 40, "intervals"],
					[500, 620, "piano"],
					[48, 900, "offsetExplorer"],
					[700, 900, "guitar"],
					[700, 1240, "scales"],
				],
				{ width: 1700, height: 2000 },
				MUSIC_KINDS,
			),
	},
};

// A board, which says agent meta: with a model to ask, its item's 🤖 wraps it in an agent
// that drives it, and ⏏ ejects it again. Beside the canvas, its own agent adds components,
// gives them agents, prompts those and ejects them.
BUNDLES.agent = {
	title: "Agent",
	components: { ...llmComponents, ...kanbanComponents, ...canvasComponents },
	askHandlers: kindHandlers(AGENT_KINDS),
	metaSchemas: { ...canvasMetaSchemas, ...agentMetaSchemas },
	// With the canvas's own agent beside it, as ?agent gives any bundle.
	agent: true,
	make: (C) =>
		canvas(
			C,
			[[48, 40, withSample(C.Board({}), "week"), "🗂️ Kanban board", 720]],
			{ width: 1600, height: 1000 },
			AGENT_KINDS,
		),
};

// bundle with its canvas in an agent of its own, beside it, which adds components, gives them
// agents, prompts those and ejects them (withAssistant): what ?agent asks for. The documents
// saved without it keep their shape.
export const withAgent = (bundle) => ({
	...bundle,
	agent: true,
	metaSchemas: { ...bundle.metaSchemas, ...agentMetaSchemas },
	make: (C) => withAssistant(C, bundle.make(C)),
});
// The bundle id names (default when it isn't known), in an agent with agent or when it comes
// in one; id says which it is.
export const bundleFrom = (id, agent = false) => {
	const known = Object.hasOwn(BUNDLES, id ?? "") ? id : "default";
	const base = { ...BUNDLES[known], id: known };
	return agent || base.agent ? withAgent(base) : base;
};
// The bundle the page's ?bundle= names, or the default one, in an agent with ?agent.
export const bundleOf = (window) => {
	const params = new URLSearchParams(window?.location.search ?? "");
	return bundleFrom(params.get("bundle"), params.has("agent"));
};
