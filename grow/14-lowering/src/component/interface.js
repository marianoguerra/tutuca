// Interfaces: what a component offers other components, by name and type, and no state.
// messages and pure map names to argument types; queries map names to { args, returns }.

export class Interface {
	constructor(name, { messages = {}, pure = {}, queries = {} } = {}) {
		this.name = name;
		this.messages = messages;
		this.pure = pure;
		this.queries = queries;
	}
}
export const iface = (name, operations) => new Interface(name, operations);

// A type as its signature: what it accepts, without its default. Predicates only compare as
// "there is one".
const signature = (ty) =>
	JSON.stringify(ty, (_key, v) =>
		typeof v === "function" ? "where" : v?.kind === "Default" ? v.ty : v,
	);
const sameTypes = (want, got) =>
	got !== undefined &&
	want.length === got.length &&
	want.every((ty, i) => signature(ty) === signature(got[i]));

// What classDef lacks to implement face, as messages: none when it implements it. Each of
// face's messages needs a handler with the same argument types, each pure message a pure one,
// each query one with the same arguments and what it returns.
export function interfaceProblems(classDef, face) {
	const problems = [];
	const checkMessage = (name, args, pure) => {
		const handler = classDef.on[name];
		if (handler === undefined) problems.push(`its message ${name} is missing`);
		else if (pure && !handler.pure) problems.push(`its message ${name} isn't pure`);
		else if (!(args.length === 0 && handler.args === undefined) && !sameTypes(args, handler.args))
			problems.push(`its message ${name} takes other arguments`);
	};
	for (const [name, args] of Object.entries(face.messages)) checkMessage(name, args, false);
	for (const [name, args] of Object.entries(face.pure)) checkMessage(name, args, true);
	for (const [name, want] of Object.entries(face.queries)) {
		const query = classDef.queries[name];
		if (query === undefined) problems.push(`its query ${name} is missing`);
		else if (!sameTypes(want.args ?? [], query.args))
			problems.push(`its query ${name} takes other arguments`);
		else if (
			want.returns !== undefined &&
			!sameTypes([want.returns], [query.returns].filter(Boolean))
		)
			problems.push(`its query ${name} returns something else`);
	}
	return problems;
}
