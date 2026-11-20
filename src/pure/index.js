// tutuca/pure (experimental): handlers written as pure-js source, a subset of JavaScript (and
// TypeScript) that is checked to do nothing but read the instance, change the draft and use
// ctx, deterministically, and to end. pure-js is generic; this module is what makes a
// component a pure-js host and a handler a pure-js signature:
//
//   this    read Comp        Comp: the component's fields, its queries (read-only, typed by
//   next    draft Comp       their returns, or as the getter itself checks), its methods
//   args    [T, ...]         the handler's args types, unknown[] without them
//   ctx     a handle         sourceKey, notify, ask (names from emits), stopNext, uuid, and
//                            make(name, fields), as ctx.scope.make; a pure handler has none
//   tutuca  a module         apply(child, message, ...args) for pure messages, errorMessage
//
// Components' names are types (t.component("Todo") is Todo), as their scope finds them.
//
//   import { enableHandlerSources } from "tutuca";
//   import { pureHandlers } from "tutuca/pure";
//   enableHandlerSources(pureHandlers());
//   component({ ..., on: { setText: { args: [t.string()], run: "function (next, [text]) { next.text = text; }" } } })
//
// A handler is compiled the first time it runs, against the component and scope it runs in;
// lint checks it against the registrations it lints.

import {
	compile,
	draft,
	formatDiagnostic,
	lineColumn,
	RESERVED_NAMES,
	read,
	stdHost,
	verify,
} from "pure-js";
import { apply } from "../core/model/contract.js";
import { scopeOf, specOf } from "../core/model/spec.js";
import {
	ArrayType,
	BooleanType,
	ComponentType,
	compileType,
	EnumType,
	IndexType,
	MapType,
	NumberType,
	OneOfType,
	OptionType,
	RecordType,
	StringType,
	Type,
} from "../core/model/types.js";
import { errorMessage } from "../tree/text.js";

const RESERVED = new Set(RESERVED_NAMES);
// Names the TypeScript lib and the standard host already have, which no component type takes.
const TAKEN = new Set([
	"Array",
	"ReadonlyArray",
	"String",
	"Number",
	"Boolean",
	"Object",
	"Function",
	"RegExp",
	"Math",
	"JSON",
	"Ctx",
	"IArguments",
	"CallableFunction",
	"NewableFunction",
	"TemplateStringsArray",
]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const key = (k) => (IDENT.test(k) ? k : JSON.stringify(k));
const paren = (t) => (/[|=]/.test(t) ? `(${t})` : t);

// A tutuca field type, compiled or as data, as a pure-js (TypeScript) type; known: the
// component names that are types here.
export const typeText = (typeOrData, known = new Set()) => {
	const type = typeOrData instanceof Type ? typeOrData : compileType(typeOrData);
	const of = (t) => typeText(t, known);
	if (type instanceof StringType) return "string";
	if (type instanceof NumberType) return "number";
	if (type instanceof BooleanType) return "boolean";
	if (type instanceof IndexType) return "number";
	if (type instanceof EnumType) return type.members.map((m) => JSON.stringify(m)).join(" | ");
	if (type instanceof OptionType) return `${paren(of(type.valueType))} | null`;
	if (type instanceof ArrayType) return `${paren(of(type.valueType))}[]`;
	if (type instanceof MapType) return `{ [key: string]: ${of(type.valueType)} }`;
	if (type instanceof RecordType) {
		const fields = Object.entries(type.shape).filter(([k]) => !RESERVED.has(k));
		return fields.length === 0
			? "{}"
			: `{ ${fields.map(([k, v]) => `${key(k)}: ${of(v)}`).join("; ")} }`;
	}
	if (type instanceof OneOfType) return type.types.map((t) => paren(of(t))).join(" | ");
	if (type instanceof ComponentType) {
		const names = type.names;
		if (names.length > 0 && names.every((n) => typeof n === "string" && known.has(n)))
			return names.join(" | ");
		return "unknown";
	}
	return "unknown";
};

const isTypeName = (name) => IDENT.test(name) && !TAKEN.has(name) && !name.startsWith("Ctx_");
// The specs a component's handlers can name: its own and those its scope (and the scopes
// above it) has, nearest first.
const specsInScope = (spec, scope) => {
	const out = new Map();
	if (isTypeName(spec.name)) out.set(spec.name, spec);
	for (let s = scope; s !== null && s !== undefined; s = s.parent) {
		for (const [name, sp] of Object.entries(s.specs))
			if (!out.has(name) && isTypeName(name)) out.set(name, sp);
	}
	return out;
};

const methodText = (name, args, returns, known) => {
	const params =
		args === undefined
			? "...args: unknown[]"
			: args.map((t, i) => `a${i}: ${typeText(t, known)}`).join(", ");
	return `${key(name)}(${params}): ${returns === undefined ? "unknown" : typeText(returns, known)}`;
};
// A component as a record type: fields, then queries (read-only fields and methods), then
// methods. queryTypes: query name -> type text, what checking the getters found.
const componentText = (spec, known, queryTypes) => {
	const members = [];
	for (const [name, type] of Object.entries(spec.fields)) {
		if (!RESERVED.has(name)) members.push(`${key(name)}: ${typeText(type, known)}`);
	}
	for (const [name, q] of Object.entries(spec.queries)) {
		if (RESERVED.has(name) || q.kind === "field") continue;
		if (q.kind === "get") {
			const t =
				q.returns !== undefined ? typeText(q.returns, known) : (queryTypes?.get(name) ?? "unknown");
			members.push(`readonly ${key(name)}: ${t}`);
		} else if (q.kind === "call") members.push(methodText(name, q.args, q.returns, known));
	}
	for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(spec.methods))) {
		if (RESERVED.has(name)) continue;
		members.push(
			d.get !== undefined
				? `readonly ${key(name)}: unknown`
				: methodText(name, undefined, undefined, known),
		);
	}
	return members.length === 0 ? "{}" : `{ ${members.join("; ")} }`;
};

// A handler's ctx type: the shared Ctx, or its own when its emits or sourceKey say more.
const ownCtx = (handler) => handler.emits !== undefined || handler.sourceKey !== undefined;
const handleName = (spec, handler) =>
	ownCtx(handler) ? `Ctx_${spec.name}_${handler.name.replace(/[^A-Za-z0-9_]/g, "_")}` : "Ctx";
const literals = (names) =>
	names === undefined || names.length === 0
		? "string"
		: names.map((n) => JSON.stringify(n)).join(" | ");
const partialFields = (spec, known) => {
	const fields = Object.entries(spec.fields).filter(([k]) => !RESERVED.has(k));
	return fields.length === 0
		? "{}"
		: `{ ${fields.map(([k, v]) => `${key(k)}?: ${typeText(v, known)}`).join("; ")} }`;
};
const ctxText = (handler, specs, known) => {
	const emits = handler?.emits ?? {};
	const make = [...specs].map(
		([name, sp]) =>
			`make(name: ${JSON.stringify(name)}, fields?: ${partialFields(sp, known)}): ${name}`,
	);
	const sourceKey =
		handler?.sourceKey === undefined ? "unknown" : typeText(handler.sourceKey, known);
	return `{ readonly sourceKey: ${sourceKey}; notify(name: ${literals(emits.notify)}, args?: unknown[]): void; ask(name: ${literals(emits.ask)}, args?: unknown[]): unknown; stopNext(): void; uuid(): string; ${make.join("; ")} }`;
};
const applyOverloads = (specs, known) =>
	[...specs].flatMap(([name, sp]) =>
		Object.values(sp.on)
			.filter((h) => h?.pure)
			.map((h) => {
				const args =
					h.args === undefined
						? "...args: unknown[]"
						: h.args.map((t, i) => `a${i}: ${typeText(t, known)}`).join(", ");
				return `(component: ${name}, message: ${JSON.stringify(h.name)}${args === "" ? "" : `, ${args}`}) => ${name}`;
			}),
	);

const handlersOf = (spec) => [
	...Object.values(spec.on),
	...Object.values(spec.answers).flatMap((outcomes) =>
		outcomes && typeof outcomes === "object" ? Object.values(outcomes) : [],
	),
];

// The pure-js host of a universe of components (by name): the standard host, the components
// as types, the Ctx handles, the tutuca module. queryTypes: spec -> query -> type text.
const buildHost = (specs, queryTypes) => {
	const known = new Set(specs.keys());
	const types = {};
	for (const [name, sp] of specs) types[name] = componentText(sp, known, queryTypes.get(sp));
	const handles = { Ctx: ctxText(null, specs, known) };
	const nondeterministic = ["Ctx.uuid"];
	for (const sp of specs.values()) {
		for (const h of handlersOf(sp)) {
			if (h === null || typeof h !== "object" || h.pure || !ownCtx(h)) continue;
			const hn = handleName(sp, h);
			handles[hn] = ctxText(h, specs, known);
			nondeterministic.push(`${hn}.uuid`);
		}
	}
	const overloads = applyOverloads(specs, known);
	const tutuca = { errorMessage: "(error: unknown) => string" };
	if (overloads.length > 0) tutuca.apply = overloads;
	return stdHost.extend(
		{ types, handles, modules: { tutuca }, nondeterministic },
		{ "tutuca.apply": apply, "tutuca.errorMessage": errorMessage },
	);
};
// Queries typed by checking their getters: twice, so a query that reads another one gets its
// type the second time.
const inferQueries = (specs) => {
	const queryTypes = new Map();
	for (let round = 0; round < 2; round++) {
		const host = buildHost(specs, queryTypes);
		const next = new Map();
		for (const [name, sp] of specs) {
			const found = new Map();
			for (const [qname, q] of Object.entries(sp.queries)) {
				if (q.kind !== "get" || q.returns !== undefined || typeof q.fn !== "function") continue;
				let type = "unknown";
				try {
					const v = verify(String(q.fn), { host, signature: { this: read(name) } });
					if (v.diagnostics.length === 0 && v.returnType !== null && v.returnType !== "void")
						type = v.returnType;
				} catch {
					// A getter whose type pure-js can't write down stays unknown.
				}
				found.set(qname, type);
			}
			next.set(sp, found);
		}
		for (const [sp, found] of next) queryTypes.set(sp, found);
	}
	return queryTypes;
};

// Hosts by universe: the specs in reach, compared by identity.
const universes = [];
const universeHost = (specs) => {
	const list = [...specs.values()];
	const names = [...specs.keys()];
	for (const u of universes) {
		if (
			u.list.length === list.length &&
			u.list.every((s, i) => s === list[i] && u.names[i] === names[i])
		)
			return u.host;
	}
	const host = buildHost(specs, inferQueries(specs));
	universes.push({ list, names, host });
	if (universes.length > 32) universes.shift();
	return host;
};

// The entry signature of a handler of spec, its args typed with the components in known.
export const handlerSignature = (spec, handler, known = new Set([spec.name])) => {
	const args =
		handler.args === undefined
			? "unknown[]"
			: `[${handler.args.map((t) => typeText(t, known)).join(", ")}]`;
	const params = [draft(spec.name), args];
	if (!handler.pure) params.push(handleName(spec, handler));
	return { this: read(spec.name), params, result: "void" };
};
const signatureIn = (spec, handler, specs) =>
	handlerSignature(spec, handler, new Set(specs.keys()));

const where = (source, d) => {
	const { line, column } = lineColumn(source, d.start);
	return `line ${line}, column ${column}`;
};
export class HandlerSourceError extends Error {
	constructor(spec, handler, diagnostics) {
		const text = diagnostics
			.map((d) => formatDiagnostic(d, handler.source, `${spec.name}.${handler.name}`))
			.join("\n\n");
		super(`${spec.name}.${handler.name} is not a pure-js handler:\n${text}`);
		this.name = "HandlerSourceError";
		this.diagnostics = diagnostics;
	}
}

// What enableHandlerSources takes: compiles a handler the first time it runs, in the scope it
// runs in, and checks one for lint. deterministic: reject ctx.uuid and the like.
export const pureHandlers = ({ deterministic = false } = {}) => {
	const compiled = new WeakMap(); // handler -> Map(host -> function)
	return {
		compile(handler, { spec, scope }) {
			const specs = specsInScope(spec, scope);
			const host = universeHost(specs);
			if (!compiled.has(handler)) compiled.set(handler, new Map());
			const byHost = compiled.get(handler);
			const done = byHost.get(host);
			if (done !== undefined) return done;
			const c = compile(handler.source, {
				host,
				signature: signatureIn(spec, handler, specs),
				deterministic,
			});
			if (!c.ok) throw new HandlerSourceError(spec, handler, c.diagnostics);
			const fn = handler.pure
				? function (next, args) {
						return c.fn.call(this, next, args);
					}
				: function (next, args, ctx) {
						return c.fn.call(this, next, args, ctx);
					};
			byHost.set(host, fn);
			return fn;
		},
		// Diagnostics, each with where it is in the handler's source.
		check(handler, { spec, specs = [spec] }) {
			const byName = new Map();
			for (const sp of [spec, ...specs])
				if (isTypeName(sp.name) && !byName.has(sp.name)) byName.set(sp.name, sp);
			const host = universeHost(byName);
			const v = verify(handler.source, {
				host,
				signature: signatureIn(spec, handler, byName),
				deterministic,
			});
			return v.diagnostics.map((d) => ({
				code: d.code,
				message: d.message,
				where: where(handler.source, d),
				diagnostic: d,
			}));
		},
	};
};

// The instance's own handler, checked: its diagnostics (for tools that have an instance).
export const checkHandlerOf = (instance, name, options = {}) => {
	const spec = specOf(instance);
	const handler = spec.on[name];
	if (handler?.source === null || handler?.source === undefined) return [];
	return pureHandlers(options).check(handler, {
		spec,
		specs: [...specsInScope(spec, scopeOf(instance)).values()],
	});
};

export {
	checkComponentSource,
	componentAsks,
	defineComponentSource,
	instancesIn,
	listScopes,
	removeScope,
	unregisterComponent,
} from "./define.js";
export {
	checkReportText,
	defineReportText,
	diagnosticText,
	removedText,
	scopesText,
} from "./define-text.js";
// A whole component written as a pure-tutuca module (module.js).
export { componentModule } from "./module.js";
