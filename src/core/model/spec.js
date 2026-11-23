// The parts of a ComponentSpec (../component.js) and the identity a component instance carries:
// its spec and scope, the specs of its messages, answers and queries, and how component()'s
// options become them.

export const specSym = Symbol("TutucaSpec");
export const scopeSym = Symbol("TutucaScope");
export const specOf = (v) => v?.[specSym];
export const scopeOf = (v) => v?.[scopeSym] ?? null;
export const isComponent = (v) => specOf(v) !== undefined;
// A ComponentSpec: its prototype's spec is itself.
export const isSpec = (v) => v?.proto?.[specSym] === v;
// The spec of c, a component or its spec.
export const specOrSelf = (c) => specOf(c) ?? c;
// An on entry is a handler function, or a handler spec { run, args, params, sourceKey, pre, why,
// post, emits, pure, swap }: the handler, run, with its contract. run changes next and returns
// nothing; a swap's run may return the component its own becomes instead (nothing keeps it,
// with what next has), and anything else a run returns fails its task (tree-binding.js). args types the send/notify arguments,
// sourceKey the child key it arrives from, pre and post are conditions on the instance (why,
// given self and args, says in words why pre doesn't hold), and emits lists what it may send
// as { notify, ask, sendAt } name arrays. A pure one runs as run(next, args),
// without a ctx: it can't send or read the world, so it can also be applied (contract.js) to a
// component synchronously, in whatever transaction the caller is in.
//
// run may also be source text, a pure-js program (tutuca/pure): source keeps it, and run is a
// function that compiles it the first time it runs, with what enableHandlerSources was given,
// against the component it runs in.
//
// args and sourceKey are types as data (types.js), compiled with type, the component's
// compileType.
export class HandlerSpec {
	constructor(name, entry, type) {
		const spec = typeof entry === "function" || typeof entry === "string" ? { run: entry } : entry;
		this.name = name;
		this.args = argTypes(`${name}.args`, spec.args, type);
		// The args' names, in order, where they're known (a pure-tutuca handler's, as its run
		// destructures them): what tools and docs call them. undefined when not said.
		this.params = paramNames(`${name}.params`, spec.params, type);
		this.sourceKey =
			spec.sourceKey === undefined ? undefined : type(spec.sourceKey, `${name}.sourceKey`);
		this.pre = spec.pre;
		this.why = spec.why;
		this.post = spec.post;
		this.emits = spec.emits;
		this.pure = spec.pure === true;
		// A swap's run returns the component its own becomes, or nothing to stay (messages.js).
		this.swap = spec.swap === true;
		this.source = typeof spec.run === "string" ? spec.run : null;
		this.run = this.source === null ? spec.run : sourceRun(this);
	}
}
// A list of arg types compiled, undefined for none said.
const argTypes = (label, args, type) => {
	if (args === undefined) return undefined;
	if (!Array.isArray(args)) return type.fail(`${label} must be an array of types`);
	return args.map((a, i) => type(a, `${label}[${i}]`));
};
// A list of arg names, undefined for none said.
const paramNames = (label, params, type) => {
	if (params === undefined) return undefined;
	if (!Array.isArray(params) || !params.every((p) => typeof p === "string")) {
		return type.fail(`${label} must be an array of names`);
	}
	return [...params];
};
// What compiles handlers given as source: { compile(handler, { spec, scope }) -> function,
// check(handler, { spec, specs }) -> diagnostics }. tutuca/pure's pureHandlers() is one.
let handlerSources = null;
export const enableHandlerSources = (compiler) => {
	if (typeof compiler?.compile !== "function")
		throw new TypeError("enableHandlerSources takes { compile, check }");
	handlerSources = compiler;
};
export const handlerSourcesEnabled = () => handlerSources;
const sourceRun = (handler) => {
	const compiler = handlerSources;
	if (compiler === null) {
		throw new Error(
			`${handler.name} is source text: enableHandlerSources(pureHandlers()) from tutuca/pure first`,
		);
	}
	const compiled = (self) =>
		compiler.compile(handler, { spec: specOf(self), scope: scopeOf(self) });
	// A pure handler gets no ctx, and its run says so as its arity.
	return handler.pure
		? function (next, args) {
				return compiled(this).call(this, next, args);
			}
		: function (next, args, ctx) {
				return compiled(this).call(this, next, args, ctx);
			};
};
// A query: a public read of a component, with no effects. A get one reads like a field (a
// getter, a computed property; a public field is one too), a call one takes args. args and
// returns type them, for checks and tools.
export class QuerySpec {
	constructor(
		name,
		{ kind, fn = null, args = undefined, params = undefined, returns = undefined },
	) {
		this.name = name;
		this.kind = kind; // "get", "call" or "field"
		this.fn = fn; // The getter or the function; null for a field.
		this.args = kind === "call" ? args : [];
		this.params = kind === "call" ? params : []; // The args' names, where they're known.
		this.returns = returns;
	}
}
// queries' entries: a getter (get), a function (call), { get, returns } or
// { run, args, params, returns }, args and returns types as data compiled with type. Fields marked
// public are get queries returning their type. Other entries stay as they are for lint to report.
// A function or a run that takes no args is a get query too: a query without args reads as a
// field (field("score") in a view, this.score in a handler), so score() { ... } means the same
// as get score() { ... }. (fn.length counts the params before the first default, so a query
// whose args all have defaults says them in args.)
const takesNoArgs = (fn, args) => fn.length === 0 && (args === undefined || args.length === 0);
export const toQueries = (queries, fields, type) => {
	const returns = (name, v) => (v === undefined ? undefined : type(v, `queries.${name}.returns`));
	const out = Object.create(null);
	for (const name in fields) {
		if (fields[name]?.isPublic) {
			out[name] = new QuerySpec(name, { kind: "field", returns: fields[name] });
		}
	}
	for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(queries ?? {}))) {
		const v = d.value;
		if (d.get !== undefined) out[name] = new QuerySpec(name, { kind: "get", fn: d.get });
		else if (typeof v === "function")
			out[name] = new QuerySpec(name, { kind: takesNoArgs(v) ? "get" : "call", fn: v });
		else if (typeof v?.get === "function")
			out[name] = new QuerySpec(name, {
				kind: "get",
				fn: v.get,
				returns: returns(name, v.returns),
			});
		else if (typeof v?.run === "function" && takesNoArgs(v.run, v.args))
			out[name] = new QuerySpec(name, {
				kind: "get",
				fn: v.run,
				returns: returns(name, v.returns),
			});
		else if (typeof v?.run === "function")
			out[name] = new QuerySpec(name, {
				kind: "call",
				fn: v.run,
				args: argTypes(`queries.${name}.args`, v.args, type),
				params: paramNames(`queries.${name}.params`, v.params, type),
				returns: returns(name, v.returns),
			});
		else out[name] = v;
	}
	return out;
};
// An on or answers entry as a HandlerSpec; other entries stay as they are for lint to report.
const toHandler = (name, entry, type) =>
	typeof entry === "function" ||
	typeof entry === "string" ||
	(typeof entry === "object" && entry !== null)
		? new HandlerSpec(name, entry, type)
		: entry;
export const toMessages = (on, type) => {
	const messages = Object.create(null); // no toString &c in entries
	for (const key in on) messages[key] = toHandler(key, on[key], type);
	return messages;
};
// answers maps an ask's name to its outcomes' handlers, { ok, error, unhandled }, each an entry
// as on's are; its HandlerSpec is named "<ask>.<outcome>". Other shapes stay for lint.
export const toAnswers = (answers, type) => {
	const out = Object.create(null);
	for (const ask in answers) {
		const outcomes = answers[ask];
		if (typeof outcomes !== "object" || outcomes === null) {
			out[ask] = outcomes;
			continue;
		}
		out[ask] = Object.create(null);
		for (const outcome in outcomes) {
			out[ask][outcome] = toHandler(`${ask}.${outcome}`, outcomes[outcome], type);
		}
	}
	return out;
};
