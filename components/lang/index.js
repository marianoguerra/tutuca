// The AST of a small dynamically typed language: numbers, booleans, strings, variables,
// arithmetic, comparisons, and/or, if expressions and calls to built-in functions. A program
// is assignments followed by a result expression. Every node has a view and an edit view for
// each notation (Lisp, Python, JavaScript and Forth), named like viewLisp or editForth, and
// Editor pushes the one its two toggles pick above the whole tree.

import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	pushView,
	render,
	renderIt,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
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
// The kinds a hole can become, with their label in its picker.
const KINDS = {
	Num: "number",
	Bool: "boolean",
	Str: "string",
	Var: "variable",
	Arith: "arithmetic",
	Compare: "comparison",
	Logic: "and / or",
	If: "if",
	Call: "call",
};

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
const REMOVE =
	"cursor-pointer rounded px-1 font-mono text-xs opacity-0 group-hover:opacity-60 hover:text-error hover:opacity-100 focus:opacity-100";
const ADD = "cursor-pointer rounded px-1 font-mono text-xs opacity-50 hover:opacity-100";

const punct = (text) => span({ class: TEXT.punct }, text);
const keyword = (text) => span({ class: TEXT.keyword }, text);
// A node, with a button to clear it back to a hole when editing.
const node = (edit, ...children) =>
	span(
		{ class: "inline" },
		...children,
		...(edit ? [button({ class: ACTION, title: "Clear", "on:click": send("clear") }, "✕")] : []),
	);
const clear = {
	args: [],
	run(_draft, _args, ctx) {
		return ctx.scope.make("Hole", {});
	},
};

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

export const Hole = component({
	name: "Hole",
	methods: {
		evaluate() {
			throw new LangError("the program has an empty hole");
		},
	},
	views: notations((_notation, edit) =>
		edit
			? select(
					{
						class: `${PICK} ${TEXT.hole}`,
						"aria-label": "Pick a node",
						value: "",
						"on:change": send("fill", targetValue()),
					},
					option({ value: "" }, "?"),
					...Object.entries(KINDS).map(([kind, label]) => option({ value: kind }, label)),
				)
			: span({ class: TEXT.hole }, "?"),
	),
	on: {
		// Replaces itself with a new node of kind, its expressions holes.
		fill: {
			args: [t.string()],
			run(_draft, [kind], ctx) {
				if (!Object.hasOwn(KINDS, kind)) return;
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
			run(draft, [text]) {
				draft.text = text;
				const n = asNumber(text);
				if (Number.isFinite(n)) draft.value = n;
			},
		},
		clear,
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
			run(draft) {
				draft.value = !this.value;
			},
		},
		clear,
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
			run(draft, [value]) {
				draft.value = value;
			},
		},
		clear,
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
	run(draft, [name]) {
		draft.name = name;
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
	on: { setName, clear },
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
				run(draft, [op]) {
					draft.op = op;
				},
			},
			clear,
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
	on: { clear },
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
			run(draft, [fn], ctx) {
				const arity = BUILTINS[fn][0];
				draft.fn = fn;
				draft.args.splice(arity);
				draft.args.push(...holes(ctx.scope, arity - draft.args.length));
			},
		},
		clear,
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
	on: { setName },
});

export const Program = component({
	name: "Program",
	fields: {
		statements: t.array(t.component("Assign")),
		result: t.component(EXPR_NAMES),
	},
	methods: {
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
					{ class: "group" },
					renderIt(),
					" ",
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
			run(draft, _args, ctx) {
				const name = `v${this.statements.length + 1}`;
				draft.statements.push(ctx.scope.make("Assign", { name }));
			},
		},
		removeAt: {
			args: [t.index("statements")],
			post: (prev, next) => next.statements.length === prev.statements.length - 1,
			run(draft, [key]) {
				draft.statements.splice(key, 1);
			},
		},
	},
});

// The root: picks a mode and a notation and pushes both, as one view name, over the program.
export const Editor = component({
	name: "Editor",
	fields: {
		mode: t.enum("view", "edit"),
		notation: t.enum(...Object.keys(NOTATIONS)),
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
					"overflow-auto whitespace-pre-wrap rounded bg-base-200 p-4 font-mono text-sm leading-7",
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
			run(draft, [mode]) {
				draft.mode = mode;
			},
		},
		setNotation: {
			args: [t.enum(...Object.keys(NOTATIONS))],
			run(draft, [notation]) {
				draft.notation = notation;
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
