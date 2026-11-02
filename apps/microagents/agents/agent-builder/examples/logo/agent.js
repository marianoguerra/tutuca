// logo: a turtle language. The program (part kind "logo-program", a string) moves a turtle that
// draws as it goes: forward/fd n, back/bk n, right/rt deg, left/lt deg, penup/pu, pendown/pd,
// color name, repeat n [ … ]. Run draws it all; step draws one more move at a time.
export default function define(kit) {
	const { $if, button, component, each, field, send, t, tag, targetValue } = kit.tutuca;
	const { div, h2, line, p, span, svg, textarea } = tag;
	const MAX_MOVES = 5000;

	// The program as nested commands, or { error } saying where it went wrong.
	const parse = (text) => {
		const tokens = text
			.replace(/\[/g, " [ ")
			.replace(/\]/g, " ] ")
			.split(/\s+/)
			.filter((w) => w !== "");
		let at = 0;
		const number = (name) => {
			const n = Number(tokens[at++]);
			if (!Number.isFinite(n))
				throw new Error(`${name} needs a number, got "${tokens[at - 1] ?? "nothing"}"`);
			return n;
		};
		const block = (closing) => {
			const out = [];
			while (at < tokens.length) {
				const word = tokens[at++].toLowerCase();
				if (word === "]") {
					if (closing) return out;
					throw new Error("a ] without its [");
				}
				if (word === "fd" || word === "forward") out.push({ op: "move", by: number(word) });
				else if (word === "bk" || word === "back") out.push({ op: "move", by: -number(word) });
				else if (word === "rt" || word === "right") out.push({ op: "turn", by: number(word) });
				else if (word === "lt" || word === "left") out.push({ op: "turn", by: -number(word) });
				else if (word === "pu" || word === "penup") out.push({ op: "pen", down: false });
				else if (word === "pd" || word === "pendown") out.push({ op: "pen", down: true });
				else if (word === "color") out.push({ op: "color", color: tokens[at++] ?? "black" });
				else if (word === "repeat") {
					const n = number(word);
					if (tokens[at++] !== "[") throw new Error("repeat needs [ after its count");
					out.push({ op: "repeat", n, body: block(true) });
				} else throw new Error(`unknown command "${word}"`);
			}
			if (closing) throw new Error("a [ without its ]");
			return out;
		};
		try {
			return { commands: block(false) };
		} catch (error) {
			return { error: error.message };
		}
	};
	// The segments the turtle draws, from (0,0) facing up.
	const trace = (commands) => {
		const segments = [];
		const turtle = { x: 0, y: 0, heading: 0, down: true, color: "black" };
		let moves = 0;
		const run = (list) => {
			for (const c of list) {
				if (moves >= MAX_MOVES) return;
				if (c.op === "repeat") for (let i = 0; i < c.n; i++) run(c.body);
				else if (c.op === "turn") turtle.heading += c.by;
				else if (c.op === "pen") turtle.down = c.down;
				else if (c.op === "color") turtle.color = c.color;
				else if (c.op === "move") {
					const rad = (turtle.heading * Math.PI) / 180;
					const x = turtle.x + c.by * Math.sin(rad);
					const y = turtle.y - c.by * Math.cos(rad);
					if (turtle.down)
						segments.push({ x1: turtle.x, y1: turtle.y, x2: x, y2: y, color: turtle.color });
					Object.assign(turtle, { x, y });
					moves++;
				}
			}
		};
		run(commands);
		return { segments, turtle, moves };
	};
	const round = (n) => Math.round(n * 100) / 100;

	const LogoLab = component({
		name: "LogoLab",
		fields: {
			program: t.string(),
			shown: t.number().int().min(-1), // How many moves are drawn; -1 for all.
		},
		methods: {
			toDomain() {
				return { program: this.program };
			},
		},
		queries: {
			get parsed() {
				return parse(this.program);
			},
			get error() {
				return this.parsed.error ?? "";
			},
			get hasError() {
				return this.error !== "";
			},
			get drawing() {
				return this.hasError ? { segments: [], moves: 0 } : trace(this.parsed.commands);
			},
			get visible() {
				const all = this.drawing.segments;
				return this.shown < 0 ? all : all.slice(0, this.shown);
			},
			get lines() {
				return this.visible.map((s) => ({
					...s,
					x1: round(s.x1),
					y1: round(s.y1),
					x2: round(s.x2),
					y2: round(s.y2),
				}));
			},
			get viewBox() {
				const xs = this.drawing.segments.flatMap((s) => [s.x1, s.x2]);
				const ys = this.drawing.segments.flatMap((s) => [s.y1, s.y2]);
				if (xs.length === 0) return "-100 -100 200 200";
				const [x0, x1, y0, y1] = [
					Math.min(...xs),
					Math.max(...xs),
					Math.min(...ys),
					Math.max(...ys),
				];
				const pad = 10;
				return `${round(x0 - pad)} ${round(y0 - pad)} ${round(x1 - x0 + 2 * pad)} ${round(y1 - y0 + 2 * pad)}`;
			},
			get status() {
				const total = this.drawing.segments.length;
				return `${this.visible.length} of ${total} lines drawn`;
			},
			get summary() {
				return `Program:\n${this.program}\n${this.hasError ? `Error: ${this.error}` : `${this.drawing.segments.length} lines, the turtle ends at (${round(this.drawing.turtle.x)}, ${round(this.drawing.turtle.y)}) heading ${this.drawing.turtle.heading}°`}`;
			},
			get bounds() {
				return { viewBox: this.viewBox, lines: this.drawing.segments.length, error: this.error };
			},
		},
		view: div(
			{ class: "flex flex-col gap-3" },
			h2({ class: "text-lg font-semibold" }, "🐢 Logo"),
			textarea({
				class: "textarea textarea-bordered font-mono text-sm",
				rows: 6,
				"aria-label": "Program",
				value: field("program"),
				"on:input": send("set_program", targetValue()),
			}),
			$if(field("hasError"), p({ class: "text-sm text-error" }, field("error")), ""),
			div(
				{ class: "flex items-center gap-2" },
				button({ class: "btn btn-sm btn-primary", "on:click": send("run") }, "Run"),
				button({ class: "btn btn-sm", "on:click": send("step") }, "Step"),
				button({ class: "btn btn-sm btn-ghost", "on:click": send("reset") }, "Clear"),
				span({ class: "text-sm opacity-70" }, field("status")),
			),
			svg(
				{
					viewBox: field("viewBox"),
					class: "h-80 w-full rounded-box border border-base-300 bg-base-100",
				},
				each(
					field("lines"),
					line({
						x1: field("x1"),
						y1: field("y1"),
						x2: field("x2"),
						y2: field("y2"),
						stroke: field("color"),
						"stroke-width": 1.5,
					}),
				),
			),
		),
		on: {
			set_program: {
				pure: true,
				args: [t.string()],
				run(next, [program]) {
					next.program = program;
				},
			},
			run: {
				pure: true,
				args: [],
				run(next) {
					next.shown = -1;
				},
			},
			step: {
				pure: true,
				args: [],
				run(next) {
					const total = this.drawing.segments.length;
					next.shown = this.shown < 0 || this.shown >= total ? 1 : this.shown + 1;
				},
			},
			reset: {
				pure: true,
				args: [],
				run(next) {
					next.shown = 0;
				},
			},
		},
	});

	const programOf = (msg) => (msg.messages ?? []).find((m) => m.kind === "logo-program");
	const decode = (C, bindings, msg) => {
		const part = bindings.programs?.[0] ?? programOf(msg);
		return C.LogoLab({ program: typeof part?.data === "string" ? part.data : "", shown: -1 });
	};
	const encode = (root, msg) => {
		const kids = msg.messages ?? [];
		const at = kids.findIndex((m) => m.kind === "logo-program");
		if (at >= 0 && kids[at].data === root.program) return msg;
		const part =
			at >= 0
				? { ...kids[at], data: root.program }
				: kit.tdata.message("program", "logo-program", root.program);
		const next = at >= 0 ? kids.map((m, i) => (i === at ? part : m)) : [...kids, part];
		return { ...msg, messages: next };
	};
	return { components: { LogoLab }, root: "LogoLab", decode, encode };
}
