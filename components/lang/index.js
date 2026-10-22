// The AST of a small dynamically typed language: numbers, booleans, strings, variables,
// arithmetic, comparisons, and/or, if expressions and calls to built-in functions. A program
// is assignments followed by a result expression. Every node has a view and an edit view for
// each notation (Lisp, Python, JavaScript and Forth), named like viewLisp or editForth, and
// Editor pushes the one its two toggles pick above the whole tree.

import {
	$if,
	button,
	component,
	dragKey,
	each,
	field,
	lookupBind,
	pushView,
	render,
	renderIt,
	send,
	sourceKey,
	specOf,
	t,
	tag,
	targetValue,
	UpdatePath,
} from "../../src/tutuca.js";

const { div, input, option, pre, select, span } = tag;

// Hole goes first so an expression field defaults to an empty one.
export const EXPR_NAMES = [
	"Hole",
	"Num",
	"Bool",
	"Str",
	"Var",
	"Arith",
	"Compare",
	"Logic",
	"If",
	"Call",
];
// The notations, with the suffix of their view names.
export const NOTATIONS = { lisp: "Lisp", python: "Python", js: "Js", forth: "Forth" };
export const NOTATION_LABELS = { lisp: "Lisp", python: "Python", js: "JavaScript", forth: "Forth" };

// The views of a node: build(notation, edit) for each notation, read only and editing.
const notations = (build) => {
	const views = { main: build("lisp", false) };
	for (const [notation, suffix] of Object.entries(NOTATIONS)) {
		views[`view${suffix}`] = build(notation, false);
		views[`edit${suffix}`] = build(notation, true);
	}
	return views;
};

// Shared looks, so an edit view reads like its view.
const TEXT = {
	number: "text-info",
	bool: "text-accent",
	string: "text-success",
	name: "text-secondary",
	op: "text-warning",
	keyword: "text-primary font-semibold",
	punct: "opacity-50",
	hole: "opacity-40 italic",
};
// A control that looks like text: no box, sized to its content, a dashed underline.
const INLINE =
	"min-w-[1ch] [field-sizing:content] bg-transparent p-0 font-mono outline-none border-0 border-b border-dashed border-base-content/30 hover:border-base-content/60 focus:border-primary";
const PICK = `${INLINE} cursor-pointer appearance-none`;
const ACTION =
	"cursor-pointer rounded px-0.5 align-super font-mono text-[0.6rem] opacity-30 hover:opacity-100 hover:text-error focus:opacity-100";
const GRIP =
	"cursor-grab rounded px-0.5 align-super font-mono text-[0.6rem] opacity-30 hover:opacity-100 hover:text-primary data-[dragging]:opacity-100 data-[dragging]:text-primary";
const ROW_ACTION =
	"cursor-pointer rounded px-1 font-mono text-xs opacity-0 group-hover:opacity-60 hover:opacity-100 focus:opacity-100";
const INSERT = `${ROW_ACTION} hover:text-primary`;
const REMOVE = `${ROW_ACTION} hover:text-error`;
const ADD = "cursor-pointer rounded px-1 font-mono text-xs opacity-50 hover:opacity-100";

const punct = (text) => span({ class: TEXT.punct }, text);
const keyword = (text) => span({ class: TEXT.keyword }, text);
// A node and, when editing, a handle to drag it into a hole and a button to clear it back to one.
const node = (edit, ...children) =>
	span(
		{ class: "inline" },
		...children,
		...(edit
			? [
					span(
						{
							class: GRIP,
							draggable: "true",
							"data-dragtype": "node",
							title: "Drag into a hole to move it there (Ctrl: copy it)",
						},
						"⠿",
					),
					button({ class: ACTION, title: "Clear", "on:click": send("clear") }, "✕"),
				]
			: []),
	);
const clear = {
	args: [],
	run(_next, _args, ctx) {
		return ctx.scope.make("Hole", {});
	},
};
// A hole's placeNode on its way up to the editor: the nodes it passes leave it alone.
const PLACE_ARGS = [t.array(t.any()), t.array(t.any()), t.boolean()];
const placeNode = { args: PLACE_ARGS, run() {} };

export class LangError extends Error {}
const typeOf = (v) =>
	typeof v === "number" ? "number" : typeof v === "string" ? "string" : "boolean";
const truthy = (v) => v !== false && v !== 0 && v !== "";
const needNumbers = (op, a, b) => {
	if (typeof a !== "number" || typeof b !== "number") {
		throw new LangError(`${op} needs numbers, got ${typeOf(a)} and ${typeOf(b)}`);
	}
};
const needSame = (op, a, b) => {
	if (typeOf(a) !== typeOf(b) || typeof a === "boolean") {
		throw new LangError(
			`${op} needs two numbers or two strings, got ${typeOf(a)} and ${typeOf(b)}`,
		);
	}
};
// v, when it has type.
const need = (fn, type, v) => {
	if (typeOf(v) !== type) throw new LangError(`${fn} needs a ${type}, got ${typeOf(v)}`);
	return v;
};

// A value as the notation writes it.
export const formatValue = (v, notation) => {
	if (typeof v === "string") return notation === "forth" ? `s" ${v}"` : JSON.stringify(v);
	if (typeof v === "boolean" && notation === "python") return v ? "True" : "False";
	return String(v);
};

// The kinds a hole can become: their label in its picker, their color and how each notation
// writes one.
const example = (lisp, python, js, forth) => ({ lisp, python, js, forth });
const KINDS = {
	Num: ["number", TEXT.number, example("42", "42", "42", "42")],
	Bool: ["boolean", TEXT.bool, example("true", "True", "true", "true")],
	Str: ["string", TEXT.string, example('"hi"', '"hi"', '"hi"', 's" hi"')],
	Var: ["variable", TEXT.name, example("x", "x", "x", "x")],
	Arith: ["arithmetic", TEXT.op, example("(+ a b)", "a + b", "a + b", "a b +")],
	Compare: ["comparison", TEXT.op, example("(< a b)", "a < b", "a < b", "a b <")],
	Logic: ["and / or", TEXT.op, example("(and a b)", "a and b", "a && b", "a b and")],
	If: [
		"if",
		TEXT.keyword,
		example("(if c a b)", "a if c else b", "c ? a : b", "c IF a ELSE b THEN"),
	],
	Call: ["call", TEXT.name, example("(f a)", "f(a)", "f(a)", "a f")],
};
const HOLE =
	"cursor-pointer rounded border border-dashed border-base-content/40 px-1.5 leading-5 text-base-content/60 hover:border-primary hover:text-primary";
const HOLE_OPEN =
	"cursor-pointer rounded border border-primary bg-primary px-1.5 leading-5 text-primary-content";
const MENU =
	"absolute left-0 top-full z-20 mt-1 grid w-max grid-cols-3 gap-1 whitespace-normal rounded-box border border-base-content/10 bg-base-100 p-2 font-sans shadow-lg";
const CHOICE =
	"flex cursor-pointer flex-col items-start gap-0.5 rounded-field px-2 py-1 text-left hover:bg-base-200 focus:bg-base-200 focus:outline-none";

export const Hole = component({
	name: "Hole",
	fields: { open: t.boolean() },
	methods: {
		evaluate() {
			throw new LangError("the program has an empty hole");
		},
	},
	views: notations((notation, edit) =>
		edit
			? span(
					{
						class:
							"relative inline-block rounded data-[draggingover=node]:bg-primary/20 data-[draggingover=node]:ring-2 data-[draggingover=node]:ring-primary",
						"on:drop": send("dropNode"),
					},
					button(
						{
							class: $if(field("open"), HOLE_OPEN, HOLE),
							title: "Pick a node",
							"aria-label": "Pick a node",
							"aria-expanded": $if(field("open"), "true", "false"),
							"on:click": send("toggle"),
						},
						"?",
					),
					$if(
						field("open"),
						div(
							{ class: MENU, role: "menu", "aria-label": "Node kinds" },
							...Object.entries(KINDS).map(([kind, [label, color, written]]) =>
								button(
									{
										class: CHOICE,
										role: "menuitem",
										"data-kind": kind,
										"on:click": send("fill", kind),
									},
									span({ class: "text-xs text-base-content/60" }, label),
									span({ class: `font-mono text-sm ${color}` }, written[notation]),
								),
							),
						),
						"",
					),
				)
			: span({ class: TEXT.hole }, "?"),
	),
	on: {
		toggle: {
			args: [],
			post: (prev, next) => next.open === !prev.open,
			run(next) {
				next.open = !this.open;
			},
		},
		// A node dropped here: the editor, which holds both places, moves it, or copies it on
		// Ctrl. Other drags are ignored.
		dropNode: {
			args: [],
			emits: { notify: ["placeNode"] },
			run(_next, _args, ctx) {
				if (ctx.drag?.type !== "node") return;
				const from = ctx.drag.path.toComponentPath().resolve().keys;
				const to = ctx.path.resolve().keys;
				const copy = Boolean(ctx.event?.ctrlKey || ctx.event?.metaKey);
				ctx.notify("placeNode", [from, to, copy]);
			},
		},
		// Replaces itself with a new node of kind, its expressions holes.
		fill: {
			args: [t.enum(...Object.keys(KINDS))],
			run(_next, [kind], ctx) {
				if (kind === "Call") return newCall(ctx.scope, BUILTIN_NAMES[0]);
				return ctx.scope.make(kind, {});
			},
		},
	},
});

// text is what the user typed; value follows it whenever it reads as a number.
const asNumber = (text) => (text.trim() === "" ? Number.NaN : Number(text));
export const Num = component({
	name: "Num",
	fields: { value: t.number(), text: t.string("0") },
	invariants: {
		valueFollowsText() {
			const n = asNumber(this.text);
			return !Number.isFinite(n) || n === this.value;
		},
	},
	methods: {
		evaluate() {
			return this.value;
		},
		get textClass() {
			return Number.isFinite(asNumber(this.text))
				? `${TEXT.number} ${INLINE}`
				: `${TEXT.number} ${INLINE} text-error`;
		},
	},
	views: notations((_notation, edit) =>
		edit
			? node(
					edit,
					input({
						class: field("textClass"),
						inputmode: "decimal",
						"aria-label": "number",
						value: field("text"),
						"on:input": send("setText", targetValue()),
					}),
				)
			: span({ class: TEXT.number }, field("value")),
	),
	on: {
		setText: {
			args: [t.string()],
			post: (_prev, next, [text]) => next.text === text,
			run(next, [text]) {
				next.text = text;
				const n = asNumber(text);
				if (Number.isFinite(n)) next.value = n;
			},
		},
		clear,
		placeNode,
	},
});

export const Bool = component({
	name: "Bool",
	fields: { value: t.boolean() },
	methods: {
		evaluate() {
			return this.value;
		},
	},
	views: notations((notation, edit) => {
		const text =
			notation === "python"
				? $if(field("value"), "True", "False")
				: $if(field("value"), "true", "false");
		return edit
			? node(
					edit,
					button(
						{
							class: `${TEXT.bool} cursor-pointer border-b border-dashed border-base-content/30 hover:border-current`,
							title: "Toggle",
							"aria-label": "boolean",
							"on:click": send("toggle"),
						},
						text,
					),
				)
			: span({ class: TEXT.bool }, text);
	}),
	on: {
		toggle: {
			args: [],
			post: (prev, next) => next.value === !prev.value,
			run(next) {
				next.value = !this.value;
			},
		},
		clear,
		placeNode,
	},
});

export const Str = component({
	name: "Str",
	fields: { value: t.string() },
	methods: {
		evaluate() {
			return this.value;
		},
		// JSON's escapes are close enough to Lisp's, Python's and JavaScript's.
		get quoted() {
			return JSON.stringify(this.value);
		},
	},
	views: notations((notation, edit) => {
		const open = notation === "forth" ? 's" ' : '"';
		if (!edit) {
			return notation === "forth"
				? span({ class: TEXT.string }, open, field("value"), '"')
				: span({ class: TEXT.string }, field("quoted"));
		}
		return node(
			edit,
			span(
				{ class: TEXT.string },
				open,
				input({
					class: INLINE,
					"aria-label": "string",
					value: field("value"),
					"on:input": send("setValue", targetValue()),
				}),
				'"',
			),
		);
	}),
	on: {
		setValue: {
			args: [t.string()],
			post: (_prev, next, [value]) => next.value === value,
			run(next, [value]) {
				next.value = value;
			},
		},
		clear,
		placeNode,
	},
});

const nameInput = (label) =>
	input({
		class: `${TEXT.name} ${INLINE}`,
		"aria-label": label,
		value: field("name"),
		"on:input": send("setName", targetValue()),
	});
const setName = {
	args: [t.string()],
	post: (_prev, next, [name]) => next.name === name,
	run(next, [name]) {
		next.name = name;
	},
};

export const Var = component({
	name: "Var",
	fields: { name: t.string("x") },
	methods: {
		evaluate(env) {
			if (!env.has(this.name)) throw new LangError(`${this.name} is not defined`);
			return env.get(this.name);
		},
	},
	views: notations((_notation, edit) =>
		edit ? node(edit, nameInput("variable")) : span({ class: TEXT.name }, field("name")),
	),
	on: { setName, clear, placeNode },
});

// The operators of a kind of binary node, as each notation spells them.
const spell = (lisp, python, js, forth) => ({ lisp, python, js, forth });
const ARITH_OPS = {
	"+": spell("+", "+", "+", "+"),
	"-": spell("-", "-", "-", "-"),
	"*": spell("*", "*", "*", "*"),
	"/": spell("/", "/", "/", "/"),
	"%": spell("mod", "%", "%", "mod"),
};
const COMPARE_OPS = {
	"<": spell("<", "<", "<", "<"),
	"<=": spell("<=", "<=", "<=", "<="),
	">": spell(">", ">", ">", ">"),
	">=": spell(">=", ">=", ">=", ">="),
	"==": spell("=", "==", "===", "="),
	"!=": spell("not=", "!=", "!==", "<>"),
};
const LOGIC_OPS = {
	and: spell("and", "and", "&&", "and"),
	or: spell("or", "or", "||", "or"),
};

// Infix notations wrap the node in parentheses, so precedence never needs the parent.
const binaryView = (ops) => (notation, edit) => {
	const op = edit
		? select(
				{
					class: `${PICK} ${TEXT.op}`,
					"aria-label": "operator",
					value: field("op"),
					"on:change": send("setOp", targetValue()),
				},
				...Object.entries(ops).map(([op, spelled]) => option({ value: op }, spelled[notation])),
			)
		: span({ class: TEXT.op }, field(`${notation}Op`));
	const left = render(field("left"));
	const right = render(field("right"));
	if (notation === "lisp") return node(edit, punct("("), op, " ", left, " ", right, punct(")"));
	if (notation === "forth") return node(edit, left, " ", right, " ", op);
	return node(edit, punct("("), left, " ", op, " ", right, punct(")"));
};
const binary = (name, ops, apply) =>
	component({
		name,
		fields: {
			op: t.enum(...Object.keys(ops)),
			left: t.component(EXPR_NAMES),
			right: t.component(EXPR_NAMES),
		},
		methods: {
			evaluate(env) {
				return apply(this.op, this.left, this.right, env);
			},
			get lispOp() {
				return ops[this.op].lisp;
			},
			get pythonOp() {
				return ops[this.op].python;
			},
			get jsOp() {
				return ops[this.op].js;
			},
			get forthOp() {
				return ops[this.op].forth;
			},
		},
		views: notations(binaryView(ops)),
		on: {
			setOp: {
				args: [t.enum(...Object.keys(ops))],
				post: (_prev, next, [op]) => next.op === op,
				run(next, [op]) {
					next.op = op;
				},
			},
			clear,
			placeNode,
		},
	});

export const Arith = binary("Arith", ARITH_OPS, (op, left, right, env) => {
	const a = left.evaluate(env);
	const b = right.evaluate(env);
	if (op === "+" && typeof a === "string" && typeof b === "string") return a + b;
	needNumbers(op, a, b);
	if ((op === "/" || op === "%") && b === 0) throw new LangError("division by zero");
	if (op === "+") return a + b;
	if (op === "-") return a - b;
	if (op === "*") return a * b;
	if (op === "/") return a / b;
	return a % b;
});

export const Compare = binary("Compare", COMPARE_OPS, (op, left, right, env) => {
	const a = left.evaluate(env);
	const b = right.evaluate(env);
	if (op === "==") return a === b;
	if (op === "!=") return a !== b;
	needSame(op, a, b);
	if (op === "<") return a < b;
	if (op === "<=") return a <= b;
	if (op === ">") return a > b;
	return a >= b;
});

// and and or short-circuit and give back one of their operands, as in Python.
export const Logic = binary("Logic", LOGIC_OPS, (op, left, right, env) => {
	const a = left.evaluate(env);
	if (op === "and") return truthy(a) ? right.evaluate(env) : a;
	return truthy(a) ? a : right.evaluate(env);
});

export const If = component({
	name: "If",
	fields: {
		cond: t.component(EXPR_NAMES),
		ifTrue: t.component(EXPR_NAMES),
		ifFalse: t.component(EXPR_NAMES),
	},
	methods: {
		evaluate(env) {
			return truthy(this.cond.evaluate(env))
				? this.ifTrue.evaluate(env)
				: this.ifFalse.evaluate(env);
		},
	},
	views: notations((notation, edit) => {
		const cond = render(field("cond"));
		const yes = render(field("ifTrue"));
		const no = render(field("ifFalse"));
		if (notation === "lisp") {
			return node(edit, punct("("), keyword("if"), " ", cond, " ", yes, " ", no, punct(")"));
		}
		if (notation === "python") {
			return node(
				edit,
				punct("("),
				yes,
				" ",
				keyword("if"),
				" ",
				cond,
				" ",
				keyword("else"),
				" ",
				no,
				punct(")"),
			);
		}
		if (notation === "js") {
			return node(
				edit,
				punct("("),
				cond,
				" ",
				keyword("?"),
				" ",
				yes,
				" ",
				keyword(":"),
				" ",
				no,
				punct(")"),
			);
		}
		return node(
			edit,
			cond,
			" ",
			keyword("IF"),
			" ",
			yes,
			" ",
			keyword("ELSE"),
			" ",
			no,
			" ",
			keyword("THEN"),
		);
	}),
	on: { clear, placeNode },
});

// The built-in functions: how many arguments they take and what they do.
const BUILTINS = {
	max: [2, (a, b) => Math.max(need("max", "number", a), need("max", "number", b))],
	min: [2, (a, b) => Math.min(need("min", "number", a), need("min", "number", b))],
	abs: [1, (a) => Math.abs(need("abs", "number", a))],
	len: [1, (s) => need("len", "string", s).length],
	upper: [1, (s) => need("upper", "string", s).toUpperCase()],
	str: [1, (v) => (typeof v === "string" ? v : formatValue(v, "js"))],
	concat: [2, (a, b) => need("concat", "string", a) + need("concat", "string", b)],
};
const BUILTIN_NAMES = Object.keys(BUILTINS);
const holes = (scope, n) => Array.from({ length: n }, () => scope.make("Hole", {}));
const newCall = (scope, fn) => scope.make("Call", { fn, args: holes(scope, BUILTINS[fn][0]) });

// Loop state for commas: an argument is last when no other follows it.
const commas = {
	prepare(items) {
		return { last: items.length - 1 };
	},
	enrich({ key }, { last }) {
		return { comma: key === last ? "" : ", " };
	},
};

export const Call = component({
	name: "Call",
	fields: {
		fn: t.enum(...BUILTIN_NAMES),
		args: t.array(t.component(EXPR_NAMES)),
	},
	methods: {
		evaluate(env) {
			const [arity, apply] = BUILTINS[this.fn];
			if (this.args.length !== arity) {
				throw new LangError(`${this.fn} takes ${arity} arguments, got ${this.args.length}`);
			}
			return apply(...this.args.map((arg) => arg.evaluate(env)));
		},
	},
	loops: { args: commas },
	views: notations((notation, edit) => {
		const fn = edit
			? select(
					{
						class: `${PICK} ${TEXT.name}`,
						"aria-label": "function",
						value: field("fn"),
						"on:change": send("setFn", targetValue()),
					},
					...BUILTIN_NAMES.map((name) => option({ value: name }, name)),
				)
			: span({ class: TEXT.name }, field("fn"));
		if (notation === "lisp") {
			return node(edit, punct("("), fn, each(field("args"), span(" ", renderIt())), punct(")"));
		}
		if (notation === "forth") return node(edit, each(field("args"), span(renderIt(), " ")), fn);
		return node(
			edit,
			fn,
			punct("("),
			each(field("args"), span(renderIt(), punct(lookupBind("comma"))), "args"),
			punct(")"),
		);
	}),
	on: {
		// Keeps the arguments that fit the new function and fills the rest with holes.
		setFn: {
			args: [t.enum(...BUILTIN_NAMES)],
			post: (_prev, next, [fn]) => next.fn === fn && next.args.length === BUILTINS[fn][0],
			run(next, [fn], ctx) {
				const arity = BUILTINS[fn][0];
				next.fn = fn;
				next.args.splice(arity);
				next.args.push(...holes(ctx.scope, arity - next.args.length));
			},
		},
		clear,
		placeNode,
	},
});

export const Assign = component({
	name: "Assign",
	fields: { name: t.string("x"), value: t.component(EXPR_NAMES) },
	methods: {
		execute(env) {
			env.set(this.name, this.value.evaluate(env));
		},
	},
	views: notations((notation, edit) => {
		const name = edit ? nameInput("name") : span({ class: TEXT.name }, field("name"));
		const value = render(field("value"));
		if (notation === "lisp") {
			return span(punct("("), keyword("define"), " ", name, " ", value, punct(")"));
		}
		if (notation === "python") return span(name, " ", punct("="), " ", value);
		if (notation === "js")
			return span(keyword("let"), " ", name, " ", punct("="), " ", value, punct(";"));
		return span(value, " ", keyword("VALUE"), " ", name);
	}),
	on: { setName, placeNode },
});

// Whether a drop landed on the lower half of the element that handles it; one without a
// position, as in tests, lands on the upper half.
const isLowerHalf = ({ event, node }) => {
	if (node === null || typeof event?.clientY !== "number") return false;
	const rect = node.getBoundingClientRect();
	return event.clientY > rect.top + rect.height / 2;
};
// Whether the drag is of one of this program's statements, by the handle in its row.
const isOwnStatement = (ctx) =>
	ctx.drag?.type === "statement" && String(ctx.drag.path.toComponentPath()) === String(ctx.path);

export const Program = component({
	name: "Program",
	fields: {
		statements: t.array(t.component("Assign")),
		result: t.component(EXPR_NAMES),
	},
	methods: {
		// An assignment of a hole to a name no statement uses yet.
		newStatement(scope) {
			const used = new Set(this.statements.map((s) => s.name));
			let n = this.statements.length + 1;
			while (used.has(`v${n}`)) n++;
			return scope.make("Assign", { name: `v${n}` });
		},
		// The value of the result once every statement ran, in order.
		execute() {
			const env = new Map();
			for (const statement of this.statements) statement.execute(env);
			return this.result.evaluate(env);
		},
	},
	views: notations((notation, edit) => {
		const row = edit
			? div(
					{
						class:
							"group rounded data-[draggingover=statement]:bg-primary/10 data-[draggingover=statement]:ring-1 data-[draggingover=statement]:ring-primary",
						"on:drop": send("moveStatement", dragKey(), sourceKey()),
					},
					span(
						{
							class: `${ROW_ACTION} cursor-grab`,
							draggable: "true",
							"data-dragtype": "statement",
							title: "Drag to move this statement",
						},
						"⠿",
					),
					" ",
					renderIt(),
					" ",
					button(
						{
							class: INSERT,
							title: "Add a statement after (Ctrl+click: before)",
							"on:click": send("insertAt", sourceKey()),
						},
						"+",
					),
					button(
						{
							class: REMOVE,
							title: "Remove statement",
							"on:click": send("removeAt", sourceKey()),
						},
						"✕",
					),
				)
			: div(renderIt());
		const result =
			notation === "forth"
				? [render(field("result")), " ", keyword(".")]
				: [render(field("result"))];
		return div(
			each(field("statements"), row),
			...(edit ? [div(button({ class: ADD, "on:click": send("add") }, "+ statement"))] : []),
			div({ class: "mt-2" }, ...result),
		);
	}),
	on: {
		add: {
			args: [],
			post: (prev, next) => next.statements.length === prev.statements.length + 1,
			run(next, _args, ctx) {
				next.statements.push(this.newStatement(ctx.scope));
			},
		},
		// Adds a statement after the one at key, or before it on Ctrl+click.
		insertAt: {
			args: [t.index("statements")],
			post: (prev, next) => next.statements.length === prev.statements.length + 1,
			run(next, [key], ctx) {
				const before = ctx.event?.ctrlKey || ctx.event?.metaKey;
				next.statements.splice(before ? key : key + 1, 0, this.newStatement(ctx.scope));
			},
		},
		// A statement dragged onto the one at onto: it goes above it, or below when dropped on
		// its lower half. Drags of anything else, or from another program, are ignored.
		moveStatement: {
			args: [t.option(t.index("statements")), t.index("statements")],
			post: (prev, next) => next.statements.length === prev.statements.length,
			run(next, [from, onto], ctx) {
				if (from === null || from === onto || !isOwnStatement(ctx)) return;
				let to = isLowerHalf(ctx) ? onto + 1 : onto;
				if (from < to) to--;
				const [statement] = next.statements.splice(from, 1);
				next.statements.splice(to, 0, statement);
			},
		},
		placeNode,
		removeAt: {
			args: [t.index("statements")],
			post: (prev, next) => next.statements.length === prev.statements.length - 1,
			run(next, [key]) {
				next.statements.splice(key, 1);
			},
		},
	},
});

// The root: picks a mode and a notation and pushes both, as one view name, over the program.
// Both are local, so each session views or edits the shared program in its own way.
export const Editor = component({
	name: "Editor",
	fields: {
		mode: t.enum("view", "edit").sync("local"),
		notation: t.enum(...Object.keys(NOTATIONS)).sync("local"),
		program: t.component("Program"),
	},
	methods: {
		get viewName() {
			return `${this.mode}${NOTATIONS[this.notation]}`;
		},
		// The program's value, or the error that stopped it.
		get outcome() {
			try {
				return { value: formatValue(this.program.execute(), this.notation) };
			} catch (error) {
				if (error instanceof LangError) return { error: error.message };
				throw error;
			}
		},
		get output() {
			const { value, error } = this.outcome;
			return error === undefined ? value : `Error: ${error}`;
		},
		get isError() {
			return this.outcome.error !== undefined;
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get isLisp() {
			return this.notation === "lisp";
		},
		get isPython() {
			return this.notation === "python";
		},
		get isJs() {
			return this.notation === "js";
		},
		get isForth() {
			return this.notation === "forth";
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		div(
			{ class: "flex flex-wrap items-center gap-2" },
			div(
				{ class: "join", role: "group", "aria-label": "Mode" },
				button(
					{
						class: $if(field("isEdit"), "btn btn-xs join-item", "btn btn-xs btn-primary join-item"),
						"data-mode": "view",
						"on:click": send("setMode", "view"),
					},
					"View",
				),
				button(
					{
						class: $if(field("isEdit"), "btn btn-xs btn-primary join-item", "btn btn-xs join-item"),
						"data-mode": "edit",
						"on:click": send("setMode", "edit"),
					},
					"Edit",
				),
			),
			div(
				{ class: "join", role: "group", "aria-label": "Notation" },
				...Object.entries(NOTATION_LABELS).map(([notation, label]) =>
					button(
						{
							class: $if(
								field(`is${NOTATIONS[notation]}`),
								"btn btn-xs btn-primary join-item",
								"btn btn-xs join-item",
							),
							"data-notation": notation,
							"on:click": send("setNotation", notation),
						},
						label,
					),
				),
			),
		),
		pre(
			{
				class:
					"whitespace-pre-wrap break-words rounded bg-base-200 p-4 font-mono text-sm leading-7",
			},
			pushView(field("viewName"), render(field("program"))),
		),
		div(
			{
				class: $if(field("isError"), "font-mono text-sm text-error", "font-mono text-sm"),
				"aria-label": "Result",
			},
			"⇒ ",
			field("output"),
		),
	),
	on: {
		setMode: {
			args: [t.enum("view", "edit")],
			run(next, [mode]) {
				next.mode = mode;
			},
		},
		// From a hole: the node at from, keys from the root, was dropped on the hole at to. It
		// moves there, leaving a hole behind, or is copied. A node can't go into a hole inside
		// itself, and only expressions from this editor's program move.
		placeNode: {
			args: PLACE_ARGS,
			run(next, [from, to, copy], ctx) {
				ctx.stopNext();
				const base = ctx.path.resolve().keys;
				const within = (keys) => base.every((key, i) => keys[i] === key);
				if (!within(from) || !within(to)) return;
				const source = new UpdatePath(from.slice(base.length));
				const target = new UpdatePath(to.slice(base.length));
				if (source.keys.every((key, i) => target.keys[i] === key)) return;
				const nameAt = ({ keys }) => specOf(keys.reduce((v, key) => v?.[key], this))?.name;
				const name = nameAt(source);
				if (!EXPR_NAMES.includes(name) || name === "Hole" || nameAt(target) !== "Hole") return;
				const value = source.getIn(this);
				target.setIn(next, value);
				if (!copy) source.setIn(next, ctx.scope.make("Hole", {}));
			},
		},
		setNotation: {
			args: [t.enum(...Object.keys(NOTATIONS))],
			run(next, [notation]) {
				next.notation = notation;
			},
		},
	},
});

export const langComponents = {
	Hole,
	Num,
	Bool,
	Str,
	Var,
	Arith,
	Compare,
	Logic,
	If,
	Call,
	Assign,
	Program,
	Editor,
};

// A program that uses every kind of node:
//   x = 7; name = "ada"; debug = false; total = x * 2 + 1
//   big = total > 10 and len(name) == 3
//   upper(concat(name, "!")) if big or debug else str(max(x, 3))
export const sample = (C) => {
	const v = (name) => C.Var({ name });
	const n = (value) => C.Num({ value, text: String(value) });
	const assign = (name, value) => C.Assign({ name, value });
	return C.Program({
		statements: [
			assign("x", n(7)),
			assign("name", C.Str({ value: "ada" })),
			assign("debug", C.Bool({ value: false })),
			assign(
				"total",
				C.Arith({ op: "+", left: C.Arith({ op: "*", left: v("x"), right: n(2) }), right: n(1) }),
			),
			assign(
				"big",
				C.Logic({
					op: "and",
					left: C.Compare({ op: ">", left: v("total"), right: n(10) }),
					right: C.Compare({
						op: "==",
						left: C.Call({ fn: "len", args: [v("name")] }),
						right: n(3),
					}),
				}),
			),
		],
		result: C.If({
			cond: C.Logic({ op: "or", left: v("big"), right: v("debug") }),
			ifTrue: C.Call({
				fn: "upper",
				args: [C.Call({ fn: "concat", args: [v("name"), C.Str({ value: "!" })] })],
			}),
			ifFalse: C.Call({ fn: "str", args: [C.Call({ fn: "max", args: [v("x"), n(3)] })] }),
		}),
	});
};
