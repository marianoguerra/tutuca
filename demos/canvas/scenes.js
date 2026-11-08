// What each bundle's canvas starts with: one use case, worked through with the bundle's
// components at their best, the canvas's shapes saying how they connect. Each is a function of
// C, the components, as a bundle's make is.
import { canvas } from "../../components/canvas/index.js";
import { isoDay } from "../../components/common/calendar.js";
import { trackerCell } from "../../components/composition/index.js";
import { apiOperation, httpRequest, httpResponse, TASKS } from "../../components/http/index.js";
import { schemaEditor } from "../../components/json-schema/editor.js";
import {
	finalResponse,
	followUpRequest,
	inferenceRequest,
	inferenceResponse,
	structuredOutput,
	toolResult,
	WEATHER,
} from "../../components/llm/index.js";
import { transcript } from "../../components/llm/transcript.js";
import { chordExplorer, circleOfFifths, scaleExplorer } from "../../components/music/index.js";
import { offsetExplorer } from "../../components/music/select.js";
import { todoApp } from "../../components/todo/index.js";
import { apply } from "../../src/tutuca.js";

// The canvas's ink: titles in the page's dark grey, notes in a softer one, arrows in a color
// that says what they connect.
const INK = "#1f2937";
const SOFT = "#9ca3af";
const BLUE = "#3b82f6";
const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const PURPLE = "#a855f7";

// Shapes, numbered as they're made: each needs an id of its own on its canvas.
const shapes = () => {
	let made = 0;
	const id = () => `scene-${++made}`;
	return {
		text: (C, x, y, text, color = INK) => C.Text({ id: id(), x, y, text, stroke: color }),
		arrow: (C, [x0, y0], [x1, y1], color = SOFT) =>
			C.Arrow({ id: id(), x0, y0, x1, y1, stroke: color, width: 2 }),
	};
};

// The notebook: a spring garden project. Its plan in markdown, the beds sketched in a drawing,
// the seedlings on a board, the work as todos and, in tabs, the watering logged and quick
// notes: every kind the notebook has, and a layout, on one canvas.
const GARDEN_PLAN = `# 🌱 Spring garden

Four **raised beds** in the back yard, planted after the last frost (mid-April).

## When to sow

| Crop | Sow indoors | Plant out |
| ---- | ----------- | --------- |
| Tomatoes | March | May |
| Peppers | March | May |
| Basil | April | May |
| Lettuce | — | April |

## Budget

- [x] Timber for the beds: 120 €
- [x] Compost, a cubic meter: 60 €
- [ ] Drip irrigation kit: 45 €

> Water in the morning, never at night.
`;
const SEEDLINGS = {
	columns: [
		{
			title: "Seeds",
			cards: [
				{ id: "g00", title: "Lettuce, direct sow in bed 4" },
				{ id: "g01", title: "Carrots" },
			],
		},
		{
			title: "Sprouting",
			cards: [
				{ id: "g10", title: "Basil, 12 pots" },
				{ id: "g11", title: "Peppers, 6 pots" },
			],
		},
		{ title: "Planted out", cards: [{ id: "g20", title: "Tomatoes, bed 1" }] },
	],
};
// The yard from above: the four beds, the path between them, the shed and the old lemon tree.
const yard = (C) => {
	const bed = (id, x, y, fill) =>
		C.Rect({ id, x0: x, y0: y, x1: x + 120, y1: y + 220, fill, stroke: "#7c2d12", width: 2 });
	return C.Drawing({
		width: 640,
		height: 400,
		shapes: [
			C.Rect({ id: "lawn", x0: 0, y0: 0, x1: 640, y1: 400, fill: "#dcfce7", stroke: "none" }),
			C.Line({ id: "path", x0: 40, y0: 320, x1: 600, y1: 320, stroke: "#a8a29e", width: 8 }),
			bed("bed-1", 40, 60, "#dc2626"),
			bed("bed-2", 180, 60, "#f59e0b"),
			bed("bed-3", 320, 60, "#16a34a"),
			bed("bed-4", 460, 60, "#84cc16"),
			C.Rect({
				id: "shed",
				x0: 560,
				y0: 340,
				x1: 630,
				y1: 395,
				fill: "#78716c",
				stroke: "#44403c",
			}),
			C.Ellipse({
				id: "tree",
				x0: 10,
				y0: 330,
				x1: 80,
				y1: 395,
				fill: "#15803d",
				stroke: "#14532d",
			}),
		],
	});
};
// Watering the plants and the other chores, logged with a tap: a few times already.
const LOGGED = { "thing:home/plants": [5, "08:10"], "thing:home/groceries": [2, "yesterday"] };
const chores = (C) => {
	const tracker = trackerCell(C, "group:home/chores");
	const things = tracker.things.map((thing) => {
		const [times, last] = LOGGED[thing.id] ?? [0, ""];
		for (let i = 0; i < times; i++) thing = apply(thing, "logged", last);
		return thing;
	});
	return C.TrackerCell({ tz: tracker.tz, section: tracker.section, things });
};
export const gardenScene = (C, today = isoDay(new Date())) => {
	const s = shapes();
	const tasks = todoApp(C, {
		today,
		projects: [
			{ name: "Garden", color: "green" },
			{ name: "Shopping", color: "orange" },
		],
		tasks: [
			{
				title: "Build the raised beds",
				due: -1,
				priority: 1,
				project: "Garden",
				labels: ["weekend"],
			},
			{
				title: "Fill the beds",
				due: 0,
				priority: 2,
				project: "Garden",
				description: "Compost at the bottom, topsoil over it",
				subtasks: [
					{ title: "Bed 1", done: true },
					{ title: "Bed 2", done: true },
					{ title: "Beds 3 and 4" },
				],
			},
			{ title: "Buy the drip irrigation kit", due: 2, project: "Shopping", labels: ["hardware"] },
			{ title: "Harden off the tomatoes", due: 4, priority: 3, project: "Garden" },
			{ title: "Ask the neighbors about their compost", project: "Garden" },
			{ title: "Order seeds", done: true, project: "Shopping" },
		],
		// Open on the garden's project: its tasks, a subtask list and due dates.
		view: "project",
		projectIndex: 1,
	});
	const notes = C.Notes({
		title: "Ideas",
		notes: [
			C.Note({ text: "Marigolds between the tomatoes, against aphids" }),
			C.Note({ text: "A bench by the lemon tree" }),
			C.Note({ text: "Save seeds from the best peppers", done: true }),
		],
	});
	const tabs = C.Tabs({ items: [chores(C), notes], labels: ["Chores log", "Ideas"], active: 0 });
	return canvas(
		C,
		[
			[48, 96, C.Markdown({ text: GARDEN_PLAN }), "📄 The plan", 440],
			[540, 96, yard(C), "🖍️ The yard, from above", 700],
			[48, 780, apply(C.Board({}), "load", SEEDLINGS), "🌿 Seedlings", 720],
			[820, 780, tasks, "✅ Garden tasks", 760],
			[1290, 96, tabs, "🗂 Log and ideas", 460],
		],
		{
			width: 1800,
			height: 1400,
			shapes: [
				s.text(C, 48, 50, "🌱 A spring garden, planned on one canvas", INK),
				s.text(C, 540, 84, "Beds 1–4 from the left, the path along the bottom", SOFT),
				s.arrow(C, [494, 360], [536, 360], GREEN),
				s.text(C, 48, 760, "Seedlings move right as they grow", SOFT),
				s.arrow(C, [774, 920], [816, 920], GREEN),
				s.text(C, 1290, 84, "Tabs: a layout of two components", SOFT),
			],
		},
	);
};

// LLM inference: one turn of a weather agent, as the two calls it takes. The first request
// gives the model the question and a tool, and it answers with a call to it; the app runs the
// tool; the second request sends it all again with the result, and the model answers, reading
// most of its prompt from the cache. Beside it the turn as an agent keeps it, and the same
// answer as a structured output.
export const llmScene = (C) => {
	const s = shapes();
	const col = (i) => 48 + i * 560;
	return canvas(
		C,
		[
			[col(0), 96, inferenceRequest(C), "📤 1. Request: the question and a tool", 520],
			[col(0), 840, inferenceResponse(C), "📥 2. Response: a call to the tool", 520],
			[col(1), 96, toolResult(C), "🛠️ 3. The app runs get_weather", 520],
			[col(1), 360, followUpRequest(C), "📤 4. Request: again, with the result", 520],
			[col(1), 1150, finalResponse(C), "📥 5. Response: the answer", 520],
			[col(2), 96, transcript(C, weatherTurn()), "💬 The turn, as an agent keeps it", 480],
			[col(2), 400, structuredOutput(C), "🧩 The answer as structured output", 480],
		],
		{
			width: 1700,
			height: 1600,
			shapes: [
				s.text(C, 48, 50, "One turn of a weather agent: two calls to the model", INK),
				s.text(C, col(2), 84, "What the user sees, and what a program reads", SOFT),
				s.arrow(C, [300, 790], [300, 834], BLUE),
				s.arrow(C, [572, 1000], [col(1) - 8, 200], AMBER),
				s.arrow(C, [col(1) + 260, 306], [col(1) + 260, 354], AMBER),
				s.arrow(C, [col(1) + 260, 1096], [col(1) + 260, 1144], BLUE),
				s.text(
					C,
					col(1),
					1500,
					"The second call reads 412 tokens of its prompt from the cache",
					SOFT,
				),
			],
		},
	);
};
// The weather turn in pi-ai's messages: the question, the call, its result and the answer.
const weatherTurn = () => [
	{ role: "user", content: WEATHER.user },
	{
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: WEATHER.call.id,
				name: WEATHER.call.name,
				arguments: WEATHER.call.input,
			},
		],
		stopReason: "toolUse",
	},
	{
		role: "toolResult",
		toolCallId: WEATHER.call.id,
		toolName: WEATHER.call.name,
		content: [{ type: "text", text: JSON.stringify(WEATHER.result) }],
		isError: false,
	},
	{ role: "assistant", content: [{ type: "text", text: WEATHER.assistant }], stopReason: "stop" },
];

// HTTP & OpenAPI: a tasks API, read and written. A web page reads a task, and the exchange is
// checked against the operation it follows: every check passes. Another page creates one and
// gets most of it wrong: the checks say how. The API's contract, the operation and the task's
// schema, is beside them, and the GET as it goes over the wire.
// An exchange, its sections in closed folded: the checks are what it's here for.
const exchange = (C, operation, request, response, closed) =>
	C.HttpExchange({
		operation,
		request: httpRequest(C, request),
		response: httpResponse(C, response),
		closed,
	});
const createOperation = (C) => apiOperation(C, TASKS.create.operation, TASKS.newTask.schema);
// Reading the task the request and response beside it are, folded: they're right there.
const readTask = (C) =>
	exchange(C, apiOperation(C), TASKS.request, TASKS.response, ["operation", "request", "response"]);
// A client that gets creating a task wrong: an empty title, a field the schema doesn't have,
// no Content-Type; and a server that answers off its schema, as text, without CORS.
const brokenCreate = (C) =>
	exchange(
		C,
		createOperation(C),
		{
			...TASKS.create.request,
			headers: [["Origin", "https://app.example.com"]],
			body: { title: "", priority: 1 },
		},
		{ status: 201, headers: [["Content-Type", "text/plain"]], body: { id: "43" } },
		["operation"],
	);
const fixedCreate = (C) =>
	exchange(C, createOperation(C), TASKS.create.request, TASKS.create.response, [
		"operation",
		"response",
	]);
export const httpScene = (C) => {
	const s = shapes();
	return canvas(
		C,
		[
			[48, 96, httpRequest(C), "📨 GET a task", 520],
			[48, 700, httpResponse(C), "📬 Its response", 520],
			[620, 96, readTask(C), "✅ Reading a task: it checks out", 560],
			[620, 520, apiOperation(C), "📘 The contract: GET /tasks/{taskId}", 560],
			[620, 1280, schemaEditor(C, TASKS.operation.responses[0].schema), "🧾 A task's schema", 420],
			[1230, 96, brokenCreate(C), "❌ Creating one: a buggy client", 560],
			[1230, 900, fixedCreate(C), "✅ Creating one, fixed", 560],
		],
		{
			width: 1850,
			height: 1700,
			shapes: [
				s.text(
					C,
					48,
					50,
					"A tasks API: requests, responses, and the contract they're checked against",
					INK,
				),
				s.text(C, 48, 84, "What goes over the wire", SOFT),
				s.arrow(C, [300, 646], [300, 694], BLUE),
				s.text(C, 620, 84, "Checked against the operation", SOFT),
				s.arrow(C, [574, 260], [614, 260], GREEN),
				s.text(C, 620, 508, "OpenAPI, as the exchanges read it", SOFT),
				s.arrow(C, [1120, 500], [1120, 462], PURPLE),
				s.text(C, 620, 1268, "What the 200 answers with", SOFT),
				s.text(C, 1230, 84, "The checks say what a buggy client got wrong", SOFT),
				s.arrow(C, [1700, 830], [1700, 890], GREEN),
				s.text(C, 1230, 888, "Fixed: edit an exchange (✎) and its checks follow", SOFT),
			],
		},
	);
};

// Music theory: writing a song in G major. The key on the circle of fifths, its scale, the
// four chords of a I–V–vi–IV progression, the pentatonic to solo over it on a guitar, the last
// chorus moved up a whole step to A, and the song's chart in markdown.
const SONG_CHART = `# Song chart, in G

| Section | Chords |
| ------- | ------ |
| Verse | G · D · Em · C |
| Chorus | G · D · Em · C |
| Solo | over the verse, G major pentatonic |
| Last chorus | A · E · F♯m · D, a whole step up |

- [x] Pick the key: one sharp, F♯
- [x] Find the chords on the circle
- [ ] Write the lyrics
`;
export const musicScene = (C) => {
	const s = shapes();
	const G = 7;
	const chordAt = (i, root, kind, label) => [
		48 + i * 600,
		790,
		chordExplorer(C, { root, kind, octave: 3 }),
		label,
		580,
	];
	return canvas(
		C,
		[
			[48, 96, circleOfFifths(C, { selected: 1 }), "⭕ The key: G major", 440],
			[540, 96, scaleExplorer(C, { root: G, kind: "major", octave: 3 }), "🎼 Its scale", 620],
			[
				1210,
				96,
				scaleExplorer(C, { root: G, kind: "majorPentatonic", octave: 3, instrument: "guitar" }),
				"🎸 The solo: G major pentatonic",
				700,
			],
			chordAt(0, G, "major", "I · G"),
			chordAt(1, 2, "major", "V · D"),
			chordAt(2, 4, "minor", "vi · Em"),
			chordAt(3, 0, "major", "IV · C"),
			[
				48,
				1230,
				offsetExplorer(C, { root: G, kind: "major", offset: 2 }),
				"⤴️ The last chorus, a whole step up",
				700,
			],
			[800, 1230, C.Markdown({ text: SONG_CHART }), "📄 The song's chart", 520],
		],
		{
			width: 2460,
			height: 1750,
			shapes: [
				s.text(C, 48, 50, "A song in G major: its key, its scale, its chords and its solo", INK),
				s.text(C, 540, 84, "Played on the piano…", SOFT),
				s.text(C, 1210, 84, "…and soloed over on a guitar", SOFT),
				s.text(
					C,
					48,
					770,
					"The progression: I – V – vi – IV, the circle's neighbors and its relative minor",
					INK,
				),
				s.arrow(C, [600, 880], [644, 880], AMBER),
				s.arrow(C, [1200, 880], [1244, 880], AMBER),
				s.arrow(C, [1800, 880], [1844, 880], AMBER),
				s.text(C, 48, 1210, "Key change: every chord a major second up, G to A", SOFT),
			],
		},
	);
};

// The agent bundle: a release, run with agents. The board tracks the work, the notes draft
// what's announced, and the canvas's agent, beside it, can add more, give any of them an agent
// of its own and prompt it.
const RELEASE = {
	columns: [
		{
			title: "To do",
			cards: [
				{ id: "c00", title: "Write the migration guide" },
				{ id: "c01", title: "Record the demo video" },
				{ id: "c02", title: "Announce it on the blog" },
			],
		},
		{
			title: "Doing",
			cards: [
				{ id: "c10", title: "Fix the flaky sync test" },
				{ id: "c11", title: "Review the changelog" },
			],
		},
		{
			title: "Done",
			cards: [
				{ id: "c20", title: "Freeze the API" },
				{ id: "c21", title: "Cut the release branch" },
			],
		},
	],
};
const RELEASE_NOTES = `# Tasks 2.0 release notes (draft)

## Highlights

- **Offline mode**: changes sync when you're back online
- **Shared boards**, with comments on every card
- A dark theme that follows your system's

## Breaking changes

| Was | Now |
| --- | --- |
| \`GET /v1/tasks\` | \`GET /v2/tasks\`, paginated |
| \`due\` as a timestamp | \`due\` as an ISO date |

## Before we ship

- [x] Freeze the API
- [ ] Migration guide
- [ ] Demo video
`;
export const releaseScene = (C) => {
	const s = shapes();
	return canvas(
		C,
		[
			[48, 96, apply(C.Board({}), "load", RELEASE), "🗂️ Release board", 760],
			[860, 96, C.Markdown({ text: RELEASE_NOTES }), "📄 Release notes", 480],
		],
		{
			width: 1600,
			height: 1100,
			// Small enough for both beside the agent's chat.
			zoom: 0.75,
			shapes: [
				s.text(C, 48, 50, "Shipping Tasks 2.0, with an agent beside the canvas", INK),
				s.text(C, 48, 580, "Try asking it:", SOFT),
				s.text(C, 48, 616, "“Start the migration guide and add it to the notes' checklist”", SOFT),
				s.text(C, 48, 652, "“Add a launch-day checklist beside the notes”", SOFT),
				s.text(C, 48, 688, "“Give the board its own agent and have it move what's done”", SOFT),
			],
		},
	);
};
