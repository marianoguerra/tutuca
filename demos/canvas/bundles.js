// The bundles the canvas demo can load, by ?bundle= (and ?agent, any of them in an agent: see
// withAgent): each is the components it registers, the meta schemas it checks them against,
// the ask handlers that tell its holes what they can become and make it, and the canvas it
// starts with, a use case worked through with its components (scenes.js). default is the
// notebook's components, planning a garden; llm the parts of an LLM request and response, a
// weather agent's turn; http an HTTP exchange and the OpenAPI operation it follows, a tasks
// API; music the circle of fifths, chords, scales, a piano and a guitar, a song in G; agent a
// release board and its notes, with the canvas's agent beside them.

import {
	COMPOSITION_KINDS,
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
import { agentMetaSchemas } from "../../src/meta/index.js";
import { gardenScene, httpScene, llmScene, musicScene, releaseScene } from "./scenes.js";

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
		make: (C) => gardenScene(C),
	},
	// One turn of a weather agent: the two requests it takes and their responses, the tool run
	// between them, the turn as a transcript and the answer as a structured output.
	llm: {
		title: "LLM inference",
		components: { ...llmComponents, ...canvasKitComponents },
		askHandlers: kindHandlers(LLM_KINDS),
		metaSchemas: canvasMetaSchemas,
		make: (C) => llmScene(C),
	},
	// A tasks API: a GET and its response, its exchange checked against the operation, a buggy
	// POST the checks catch and the fixed one, and the contract they're checked against.
	http: {
		title: "HTTP & OpenAPI",
		components: { ...httpComponents, ...canvasKitComponents },
		askHandlers: kindHandlers(HTTP_KINDS),
		metaSchemas: canvasMetaSchemas,
		make: (C) => httpScene(C),
	},
	// A song in G major: the key on the circle of fifths, its scale, the I–V–vi–IV chords, the
	// pentatonic to solo over on a guitar and the last chorus up a whole step.
	music: {
		title: "Music theory",
		components: { ...musicComponents, ...canvasKitComponents },
		askHandlers: kindHandlers(MUSIC_KINDS),
		metaSchemas: canvasMetaSchemas,
		make: (C) => musicScene(C),
	},
};

// A release run with agents: a board and its release notes in markdown, which say agent meta:
// with a model to ask, an item's 🤖 wraps it in an agent that drives it, and ⏏ ejects it
// again. Beside the canvas, its own agent adds components, gives them agents, prompts those and
// ejects them.
BUNDLES.agent = {
	title: "Agent",
	components: { ...llmComponents, ...kanbanComponents, ...canvasComponents },
	askHandlers: kindHandlers(AGENT_KINDS),
	metaSchemas: { ...canvasMetaSchemas, ...agentMetaSchemas },
	// With the canvas's own agent beside it, as ?agent gives any bundle.
	agent: true,
	make: (C) => releaseScene(C),
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
