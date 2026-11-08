// The parts of a ComponentSpec (component.js) and the identity a component instance carries:
// its spec and scope, the specs of its messages, answers and queries, and how component()'s
// options become them.

export const specSym = Symbol("TutucaSpec");
export const scopeSym = Symbol("TutucaScope");
export const specOf = (v) => v?.[specSym];
export const scopeOf = (v) => v?.[scopeSym] ?? null;
export const isComponent = (v) => specOf(v) !== undefined;
// An on entry is a handler function, or a handler spec { run, args, sourceKey, pre, why, post,
// emits, pure }: the handler, run, with its contract. args types the send/notify arguments,
// sourceKey the child key it arrives from, pre and post are conditions on the instance (why,
// given self and args, says in words why pre doesn't hold), and emits lists what it may send
// as { notify, ask, sendAt } name arrays. A pure one runs as run(next, args),
// without a ctx: it can't send or read the world, so it can also be applied (contract.js) to a
// component synchronously, in whatever transaction the caller is in.
export class HandlerSpec {
	constructor(name, entry) {
		const spec = typeof entry === "function" ? { run: entry } : entry;
		this.name = name;
		this.run = spec.run;
		this.args = spec.args;
		this.sourceKey = spec.sourceKey;
		this.pre = spec.pre;
		this.why = spec.why;
		this.post = spec.post;
		this.emits = spec.emits;
		this.pure = spec.pure === true;
	}
}
// A query: a public read of a component, with no effects. A get one reads like a field (a
// getter, a computed property; a public field is one too), a call one takes args. args and
// returns type them, for checks and tools.
export class QuerySpec {
	constructor(name, { kind, fn = null, args = undefined, returns = undefined }) {
		this.name = name;
		this.kind = kind; // "get", "call" or "field"
		this.fn = fn; // The getter or the function; null for a field.
		this.args = kind === "call" ? args : [];
		this.returns = returns;
	}
}
// queries' entries: a getter (get), a function (call), { get, returns } or
// { run, args, returns }. Fields marked public are get queries returning their type.
// Other entries stay as they are for lint to report.
export const toQueries = (queries, fields) => {
	const out = Object.create(null);
	for (const name in fields) {
		if (fields[name]?.isPublic) {
			out[name] = new QuerySpec(name, { kind: "field", returns: fields[name] });
		}
	}
	for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(queries ?? {}))) {
		const v = d.value;
		if (d.get !== undefined) out[name] = new QuerySpec(name, { kind: "get", fn: d.get });
		else if (typeof v === "function") out[name] = new QuerySpec(name, { kind: "call", fn: v });
		else if (typeof v?.get === "function")
			out[name] = new QuerySpec(name, { kind: "get", fn: v.get, returns: v.returns });
		else if (typeof v?.run === "function")
			out[name] = new QuerySpec(name, {
				kind: "call",
				fn: v.run,
				args: v.args,
				returns: v.returns,
			});
		else out[name] = v;
	}
	return out;
};
// An on or answers entry as a HandlerSpec; other entries stay as they are for lint to report.
const toHandler = (name, entry) =>
	typeof entry === "function" || (typeof entry === "object" && entry !== null)
		? new HandlerSpec(name, entry)
		: entry;
export const toMessages = (on) => {
	const messages = Object.create(null); // no toString &c in entries
	for (const key in on) messages[key] = toHandler(key, on[key]);
	return messages;
};
// answers maps an ask's name to its outcomes' handlers, { ok, error, unhandled }, each an entry
// as on's are; its HandlerSpec is named "<ask>.<outcome>". Other shapes stay for lint.
export const toAnswers = (answers) => {
	const out = Object.create(null);
	for (const ask in answers) {
		const outcomes = answers[ask];
		if (typeof outcomes !== "object" || outcomes === null) {
			out[ask] = outcomes;
			continue;
		}
		out[ask] = Object.create(null);
		for (const outcome in outcomes) {
			out[ask][outcome] = toHandler(`${ask}.${outcome}`, outcomes[outcome]);
		}
	}
	return out;
};
