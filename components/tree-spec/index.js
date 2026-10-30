// Components that show any state of the tree spec (spec/tree/): the tree of instances as SVG,
// with an arrow for every message where its address leads under the scenario's policy, and the
// queue, the responses in flight, the script and the observations as HTML. An Explorer steps
// through a scenario's state graph: at each state it lists what can happen next, and taking one
// moves to the state it leads to. model.js turns the exported JSON into these.
import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	pushView,
	render,
	renderEach,
	renderIt,
	send,
	seqItem,
	sourceKey,
	t,
	tag,
} from "../../src/tutuca.js";
import { NODE_H, NODE_W } from "./model.js";

const {
	defs,
	details,
	div,
	g,
	h2,
	h3,
	li,
	marker,
	ol,
	p,
	path,
	pre,
	rect,
	section,
	span,
	summary,
	svg,
	text,
	ul,
} = tag;

// Colors by message mode and by how its address resolves.
export const COLORS = {
	send: "#2563eb",
	notify: "#9333ea",
	request: "#d97706",
	response: "#059669",
	misroute: "#dc2626",
	meant: "#9ca3af",
};
const MODES = ["send", "notify", "request", "response", "misroute", "meant"];

// ---- the tree, as SVG ---------------------------------------------------------------
export const Instance = component({
	name: "Instance",
	fields: {
		kind: t.string(),
		id: t.number().int().min(0),
		control: t.string(), // its control state (M7), "" without
		locals: t.array(t.record({ name: t.string(), value: t.string() })),
		slots: t.array(t.component("Slot")),
		x: t.number(),
		y: t.number(),
		selected: t.boolean(),
	},
	methods: {
		get left() {
			return this.x - NODE_W / 2;
		},
		get top() {
			return this.y - NODE_H / 2;
		},
		get title() {
			return `${this.kind} #${this.id}`;
		},
		get localsText() {
			return this.locals.map(({ name, value }) => `${name}=${value}`).join("  ");
		},
		get stroke() {
			return this.selected ? "#2563eb" : "#64748b";
		},
		get strokeWidth() {
			return this.selected ? 3 : 1.5;
		},
		get titleY() {
			return this.y - 6;
		},
		get localsY() {
			return this.y + 14;
		},
		get controlY() {
			return this.top - 6;
		},
		get hasControl() {
			return this.control !== "";
		},
		// One line from this node to each child, with the step it takes.
		get edges() {
			return this.slots.flatMap((slot) =>
				slot.items.map((item) => ({
					x1: this.x,
					y1: this.y + NODE_H / 2,
					x2: item.x,
					y2: item.y - NODE_H / 2,
					lx: (this.x + item.x) / 2 + 4,
					ly: (this.y + item.y) / 2,
					step: item.step,
					dash: item.cleared ? "4 3" : "",
				})),
			);
		},
	},
	view: g(
		{ class: "ts-instance" },
		each(
			field("edges"),
			g(
				{},
				path({
					d: lookupBind("line"),
					stroke: "#94a3b8",
					"stroke-dasharray": field("dash"),
					fill: "none",
				}),
				text({ x: field("lx"), y: field("ly"), "font-size": "11", fill: "#475569" }, field("step")),
			),
			"edges",
		),
		g(
			{ class: "cursor-pointer", "on:click": send("pick") },
			rect({
				x: field("left"),
				y: field("top"),
				width: NODE_W,
				height: NODE_H,
				rx: 8,
				fill: "#ffffff",
				stroke: field("stroke"),
				"stroke-width": field("strokeWidth"),
			}),
			text(
				{
					x: field("x"),
					y: field("titleY"),
					"text-anchor": "middle",
					"font-size": "13",
					"font-weight": "bold",
				},
				field("title"),
			),
			text(
				{
					x: field("x"),
					y: field("localsY"),
					"text-anchor": "middle",
					"font-size": "11",
					fill: "#334155",
				},
				field("localsText"),
			),
			$if(
				field("hasControl"),
				text(
					{
						x: field("x"),
						y: field("controlY"),
						"text-anchor": "middle",
						"font-size": "11",
						fill: "#9333ea",
					},
					"⟨",
					field("control"),
					"⟩",
				),
				null,
			),
		),
		each(field("slots"), renderIt()),
	),
	views: {
		// The details of the selected instance, as HTML.
		card: div(
			{ class: "flex flex-col gap-1" },
			h3(
				{ class: "font-bold" },
				field("title"),
				$if(field("hasControl"), span({ class: "badge badge-sm ml-2" }, field("control")), null),
			),
			ul(
				{ class: "text-sm" },
				each(
					field("locals"),
					li(
						{},
						span({ class: "font-mono" }, field("name")),
						" = ",
						span({ class: "font-mono" }, field("value")),
					),
				),
			),
			ul({ class: "text-sm" }, each(field("slots"), renderIt("summary"))),
		),
	},
	on: {
		// A click on its box: the World selects it.
		pick: {
			args: [],
			emits: { notify: ["picked"] },
			run(_next, _args, ctx) {
				ctx.notify("picked", [this.id]);
			},
		},
	},
	loops: {
		edges: {
			enrich({ value: e }) {
				return { line: `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}` };
			},
		},
	},
});

// A slot: a field, a list or a map of children.
export const Slot = component({
	name: "Slot",
	fields: {
		name: t.string(),
		type: t.enum("field", "list", "map", "none"),
		items: t.array(t.component("Item")),
	},
	methods: {
		get count() {
			return this.items.filter((item) => !item.cleared).length;
		},
		get cleared() {
			return this.items.length - this.count;
		},
	},
	view: g({}, each(field("items"), renderIt())),
	views: {
		summary: li(
			{},
			span({ class: "font-mono" }, field("name")),
			": ",
			field("type"),
			", ",
			field("count"),
			$if(field("cleared"), span({}, " (", field("cleared"), " cleared)"), null),
		),
	},
});

// One place in a slot: an instance, or the tombstone a cleared item leaves (M3).
export const Item = component({
	name: "Item",
	fields: {
		key: t.string(),
		step: t.string(),
		cleared: t.boolean(),
		node: t.option(t.component("Instance")),
		x: t.number(),
		y: t.number(),
	},
	methods: {
		get left() {
			return this.x - NODE_W / 4;
		},
		get top() {
			return this.y - NODE_H / 4;
		},
	},
	view: $if(
		field("cleared"),
		g(
			{},
			rect({
				x: field("left"),
				y: field("top"),
				width: NODE_W / 2,
				height: NODE_H / 2,
				rx: 6,
				fill: "#f1f5f9",
				stroke: "#94a3b8",
				"stroke-dasharray": "4 3",
			}),
			text(
				{
					x: field("x"),
					y: field("y"),
					dy: 4,
					"text-anchor": "middle",
					"font-size": "11",
					fill: "#64748b",
				},
				"cleared",
			),
		),
		render(field("node")),
	),
});

// ---- messages and observations, as HTML ---------------------------------------------
export const Message = component({
	name: "Message",
	fields: {
		index: t.number().int().min(0), // its number among the state's messages, its arrows'
		mode: t.enum("send", "notify", "request", "response"),
		name: t.string(),
		args: t.string(),
		request: t.number().int().min(-1), // ρ, -1 for none
		urgent: t.boolean(),
		result: t.string(),
		from: t.string(),
		to: t.string(),
		hop: t.boolean(),
		note: t.string(), // where its address leads under the policy
		status: t.enum("ok", "host", "misroute", "stale", "orphaned"),
	},
	methods: {
		get color() {
			return COLORS[this.mode];
		},
		get label() {
			const id = this.request === -1 ? "" : ` ${this.request}`;
			return `${this.mode}${id}`;
		},
		get call() {
			return this.result === "" ? `${this.name}(${this.args})` : `${this.name} → ${this.result}`;
		},
		get route() {
			return this.hop ? `${this.from} ↑ (last hop ${this.to})` : `${this.from} → ${this.to}`;
		},
		get noteClass() {
			return {
				ok: "text-success",
				host: "text-success",
				misroute: "text-error font-bold",
				stale: "text-warning",
				orphaned: "text-warning",
			}[this.status];
		},
		get border() {
			return `border-left: 4px solid ${COLORS[this.mode]}`;
		},
	},
	view: li(
		{
			class: "bg-base-100 px-3 py-1 text-sm",
			style: field("border"),
			"on:mouseenter": send("focus"),
			"on:mouseleave": send("blur"),
		},
		div(
			{ class: "flex items-center gap-2" },
			span({ class: "badge badge-sm w-24 shrink-0" }, field("label")),
			span({ class: "font-mono" }, field("call")),
			$if(field("urgent"), span({ class: "badge badge-sm badge-warning" }, "urgent"), null),
		),
		div({ class: "font-mono text-xs opacity-70" }, field("route")),
		div({ class: field("noteClass") }, field("note")),
	),
	on: {
		focus: {
			args: [],
			emits: { notify: ["focused"] },
			run(_next, _args, ctx) {
				ctx.notify("focused", [this.index]);
			},
		},
		blur: {
			args: [],
			emits: { notify: ["focused"] },
			run(_next, _args, ctx) {
				ctx.notify("focused", [-1]);
			},
		},
	},
});

// What happened, as the model observes it; bad marks what breaks a property.
export const Observation = component({
	name: "Observation",
	fields: { kind: t.string(), text: t.string(), bad: t.boolean() },
	view: li({}, span({ class: "badge badge-xs mr-2 w-20 shrink-0" }, field("kind")), field("text")),
	views: {
		fresh: li(
			{ class: "font-bold" },
			span({ class: "badge badge-xs badge-primary mr-2 w-20 shrink-0" }, field("kind")),
			field("text"),
		),
		bad: li(
			{ class: "font-bold text-error" },
			span({ class: "badge badge-xs badge-error mr-2 w-20 shrink-0" }, field("kind")),
			field("text"),
		),
	},
});

// ---- a state --------------------------------------------------------------------------
const panel = (title, ...body) =>
	section(
		{ class: "rounded-box bg-base-200 p-3" },
		h3({ class: "mb-2 font-bold" }, title),
		...body,
	);

export const World = component({
	name: "World",
	fields: {
		policy: t.enum("by-path", "by-path-checked", "by-identity", "anchored"),
		gran: t.enum("turn", "per-hop"),
		tree: t.component("Instance"),
		hostX: t.number(),
		hostY: t.number(),
		width: t.number().min(1).default(300),
		height: t.number().min(1).default(200),
		queue: t.array(t.component("Message")),
		inflight: t.array(t.component("Message")),
		arrows: t.array(t.record({ d: t.string(), status: t.string(), msg: t.number() })),
		script: t.array(t.string()),
		obs: t.array(t.component("Observation")),
		quiescent: t.boolean(),
		// What the reader is looking at: an instance, a message, how many observations are old.
		selected: t.number().int().min(-1).default(-1),
		focused: t.number().int().min(-1).default(-1),
		seen: t.number().int().min(0),
	},
	methods: {
		get viewBox() {
			return `0 0 ${this.width} ${this.height}`;
		},
		get hostLeft() {
			return this.hostX - NODE_W / 2;
		},
		get hostTop() {
			return this.hostY - NODE_H / 2;
		},
		get hostEdge() {
			return `M ${this.hostX} ${this.hostY + NODE_H / 2} L ${this.tree.x} ${this.tree.y - NODE_H / 2}`;
		},
		get selectedNode() {
			const find = (node) => {
				if (node.id === this.selected) return node;
				for (const slot of node.slots)
					for (const item of slot.items) {
						const found = item.node && find(item.node);
						if (found) return found;
					}
				return null;
			};
			return find(this.tree);
		},
		get hasSelection() {
			return this.selectedNode !== null;
		},
		// The arrowheads and the legend, one per color.
		get markers() {
			return MODES.map((mode) => ({
				id: `ts-arrow-${mode}`,
				color: COLORS[mode],
				label: mode === "meant" ? "where the address was meant to go" : mode,
				swatch: `color: ${COLORS[mode]}`,
			}));
		},
	},
	view: div(
		{ class: "grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" },
		div(
			{ class: "flex flex-col gap-2" },
			div(
				{ class: "flex flex-wrap gap-2 text-sm" },
				span({ class: "badge" }, "policy: ", field("policy")),
				span({ class: "badge" }, "granularity: ", field("gran")),
				$if(
					field("quiescent"),
					span({ class: "badge badge-success" }, "nothing left to happen"),
					null,
				),
			),
			svg(
				{
					class: "h-auto max-w-full rounded-box border border-base-300 bg-base-100",
					width: field("width"),
					viewBox: field("viewBox"),
					xmlns: "http://www.w3.org/2000/svg",
				},
				defs(
					{},
					each(
						field("markers"),
						marker(
							{
								id: field("id"),
								viewBox: "0 0 10 10",
								refX: "9",
								refY: "5",
								markerWidth: "7",
								markerHeight: "7",
								orient: "auto-start-reverse",
							},
							path({ d: "M 0 0 L 10 5 L 0 10 z", fill: field("color") }),
						),
					),
				),
				g(
					{},
					path({ d: field("hostEdge"), stroke: "#94a3b8", fill: "none" }),
					rect({
						x: field("hostLeft"),
						y: field("hostTop"),
						width: NODE_W,
						height: NODE_H,
						rx: 8,
						fill: "#f8fafc",
						stroke: "#0f172a",
					}),
					text(
						{
							x: field("hostX"),
							y: field("hostY"),
							dy: 5,
							"text-anchor": "middle",
							"font-weight": "bold",
						},
						"host",
					),
				),
				render(field("tree")),
				each(
					field("arrows"),
					path({
						d: field("d"),
						fill: "none",
						stroke: lookupBind("color"),
						"stroke-width": lookupBind("width"),
						"stroke-dasharray": lookupBind("dash"),
						"marker-end": lookupBind("marker"),
						opacity: lookupBind("opacity"),
					}),
					"arrows",
				),
			),
			div(
				{ class: "flex flex-wrap gap-3 text-xs" },
				each(
					field("markers"),
					span(
						{ class: "flex items-center gap-1" },
						span({ style: field("swatch") }, "■"),
						field("label"),
					),
				),
			),
		),
		div(
			{ class: "flex flex-col gap-3" },
			panel(
				"Selected",
				$if(
					field("hasSelection"),
					render(field("selectedNode"), "card"),
					p({ class: "text-sm opacity-70" }, "Click a component in the tree to see its state."),
				),
			),
			panel("Queue", ol({ class: "flex flex-col gap-1" }, renderEach(field("queue")))),
			panel("In flight", ul({ class: "flex flex-col gap-1" }, renderEach(field("inflight")))),
			panel(
				"Script",
				ul({ class: "font-mono text-sm" }, each(field("script"), li({}, lookupBind("value")))),
			),
			panel(
				"Observations",
				ol(
					{ class: "flex flex-col gap-0.5 text-sm" },
					each(field("obs"), pushView(lookupBind("view"), renderIt()), "obs"),
				),
			),
		),
	),
	loops: {
		arrows: {
			enrich({ value: a }) {
				const focused = this.focused === -1 || this.focused === a.msg;
				return {
					color: COLORS[a.status],
					marker: `url(#ts-arrow-${a.status})`,
					dash: a.status === "meant" ? "5 4" : "",
					width: this.focused === a.msg ? 3 : 2,
					opacity: focused ? 1 : 0.2,
				};
			},
		},
		obs: {
			enrich({ key, value }) {
				return { view: value.bad ? "bad" : key >= this.seen ? "fresh" : "main" };
			},
		},
	},
	on: {
		// From the instance clicked: select it, or unselect it when it was.
		picked: {
			args: [t.number()],
			run(next, [id], ctx) {
				ctx.stopNext();
				next.selected = this.selected === id ? -1 : id;
				const mark = (node) => {
					node.selected = node.id === next.selected;
					for (const slot of node.slots)
						for (const item of slot.items) if (item.node) mark(item.node);
				};
				mark(next.tree);
			},
		},
		focused: {
			args: [t.number()],
			run(next, [index], ctx) {
				ctx.stopNext();
				next.focused = index;
			},
		},
	},
});

// ---- the program and the explorer ------------------------------------------------------
export const Program = component({
	name: "Program",
	fields: {
		kinds: t.array(t.string()),
		host: t.string(),
		policy: t.string(),
		gran: t.string(),
	},
	view: details(
		{ class: "rounded-box bg-base-200 p-3" },
		summary({ class: "cursor-pointer font-bold" }, "The program"),
		div(
			{ class: "mt-2 grid gap-2 md:grid-cols-2" },
			each(
				field("kinds"),
				pre({ class: "overflow-x-auto rounded bg-base-100 p-2 text-xs" }, lookupBind("value")),
			),
			pre({ class: "overflow-x-auto rounded bg-base-100 p-2 text-xs" }, field("host")),
		),
	),
});

const RULE_HINT = {
	env: "an event happens",
	"env-choice": "an event happens",
	respond: "a response arrives",
	run: "the head of the queue runs",
};

export const Explorer = component({
	name: "Explorer",
	fields: {
		name: t.string(),
		tier: t.string(),
		title: t.string(),
		blurb: t.string(),
		program: t.component("Program"),
		states: t.array(t.component("World")).len(1),
		edges: t.array(
			t.record({ from: t.number(), to: t.number(), rule: t.string(), label: t.string() }),
		),
		current: t.index("states"),
		trail: t.array(t.number().int().min(0)), // the states before this one, to go back
	},
	methods: {
		get choices() {
			return this.edges.filter((e) => e.from === this.current);
		},
		get done() {
			return this.choices.length === 0;
		},
		get steps() {
			return this.trail.length;
		},
		get atStart() {
			return this.trail.length === 0;
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		div(
			{},
			h2(
				{ class: "text-xl font-bold" },
				span({ class: "badge mr-2" }, field("tier")),
				field("title"),
			),
			p({ class: "max-w-3xl" }, field("blurb")),
		),
		render(field("program")),
		section(
			{ class: "flex flex-col gap-2 rounded-box border border-base-300 p-3" },
			div(
				{ class: "flex flex-wrap items-center gap-2" },
				span({ class: "font-bold" }, "Step ", field("steps"), ": what happens next?"),
				button(
					{ class: "btn btn-sm", "on:click": send("back"), disabled: field("atStart") },
					"← Back",
				),
				button(
					{ class: "btn btn-sm", "on:click": send("restart"), disabled: field("atStart") },
					"Restart",
				),
			),
			$if(
				field("done"),
				p(
					{ class: "text-sm opacity-70" },
					"Nothing more can happen: no events left, nothing queued or in flight.",
				),
				div(
					{ class: "flex flex-wrap gap-2" },
					each(
						field("choices"),
						button(
							{
								class: "btn btn-sm btn-outline",
								title: lookupBind("hint"),
								"on:click": send("go", sourceKey()),
							},
							field("label"),
						),
						"choices",
					),
				),
			),
		),
		render(seqItem("states", "current")),
	),
	loops: {
		choices: {
			enrich({ value }) {
				return { hint: RULE_HINT[value.rule] ?? value.rule };
			},
		},
	},
	on: {
		// The choice at that index in choices: move to the state it leads to.
		go: {
			args: [t.number().int().min(0)],
			run(next, [choice]) {
				const edge = this.choices[choice];
				if (edge === undefined) return;
				const to = edge.to;
				next.trail.push(this.current);
				next.current = to;
				// What was observed before this step is old news in the next state.
				next.states[to].seen = this.states[this.current].obs.length;
			},
		},
		back: {
			args: [],
			run(next) {
				if (this.trail.length === 0) return;
				next.current = next.trail.pop();
			},
		},
		restart: {
			args: [],
			run(next) {
				next.current = 0;
				next.trail = [];
			},
		},
	},
});

export const treeSpecComponents = {
	Instance,
	Slot,
	Item,
	Message,
	Observation,
	World,
	Program,
	Explorer,
};
