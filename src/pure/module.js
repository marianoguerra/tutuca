// tutuca/pure (experimental): componentModule, a component written as a pure-tutuca module, a
// pure-js module in the shape of tutuca's component({...}). The module's types say what a
// component is (its state type: its fields, and its queries as readonly members), a namespace
// of the same name says the rest (defaults, constraints, queries, on, invariants, views, meta,
// ...), and the namespace's methods and getters are its entries, each checked against the
// signature its place gives it:
//
//   C.on.m.run(next, args, ctx)      this: read C, next: draft C, args: the run's annotation
//   C.on.m.pre / post                this: read C, (prev[, next], args, info) => boolean
//   C.queries.q                      this: read C
//   C.invariants.n                   this: read C, => boolean
//   C.answers.a.ok / error / ...     as run
//
// The same text is what tutuca-wasm compiles (spec/pure-tutuca/README.md). The module is checked
// and compiled with pure-js; the components are ordinary component() specs; model is format 2,
// what the shared conformance corpus records.
//
//   const { ok, components, examples, interfaces, metaSchemas, askHandlers, hostAsks, diagnostics,
//     model } = componentModule(source, { resolve, hostModules });
//
// examples are each component's C.examples, by component: [{ name, start, steps, at }], at where
// its name is in the source; runExamples (examples.js) runs them.
//
// interfaces are the module's interfaces (one whose methods return Pure or Notify), as
// scope.registerInterfaces takes them; metaSchemas its meta schemas (a const C = { metaSchema:
// "uri", defaults, ... } with a type C of its fields), as scope.registerMetaSchemas takes them.
// resolve(specifier) gives the text of a module it imports: a component module (a specifier
// ending in .tutuca) is imported for its types (import type { I as Local } from "./m.tutuca"),
// read by tutuca, the others by pure-js.
//
// hostModules are the page's modules the source may import (src/pure/page.js): declarations
// with their implementations, whose results are checked against their declared types.

import {
	compileModule,
	docAt,
	draft,
	isNamespaceLiteral,
	parseModule,
	printNode,
	RESERVED_NAMES,
	read,
	stdHost,
	verifyModule,
} from "pure-js";
import { component } from "../core/component.js";
import { apply } from "../core/model/contract.js";
import { iface } from "../core/model/interface.js";
import {
	ArrayType,
	BooleanType,
	compileShape,
	EnumType,
	IndexType,
	MapType,
	NumberType,
	OneOfType,
	OptionType,
	RecordType,
	StringType,
	Type,
	t,
	unlessNoDefault,
} from "../core/model/types.js";
import { button, tag } from "../core/view/tag.js";
import * as V from "../core/view/view.js";
import { errorMessage } from "../tree/text.js";
import { dataDeclaration, dataImpls } from "./data.js";
import { pageDeclaration, pageImpls } from "./page.js";

const RESERVED = new Set(RESERVED_NAMES);
const VIEW_SPEC = "tutuca/view";
const SVG_TAGS = [
	"svg",
	"g",
	"circle",
	"ellipse",
	"rect",
	"line",
	"path",
	"polyline",
	"polygon",
	"text",
	"tspan",
	"defs",
	"title",
];
const MATH_TAGS = [
	"math",
	"mi",
	"mn",
	"mo",
	"ms",
	"mtext",
	"mrow",
	"mfrac",
	"msqrt",
	"mroot",
	"msub",
	"msup",
	"msubsup",
	"munder",
	"mover",
	"munderover",
	"mspace",
	"mtable",
	"mtr",
	"mtd",
];
const TAGS = [
	"a",
	"abbr",
	"article",
	"aside",
	"b",
	"blockquote",
	"br",
	"canvas",
	"caption",
	"code",
	"dd",
	"details",
	"dialog",
	"div",
	"dl",
	"dt",
	"em",
	"fieldset",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"i",
	"img",
	"input",
	"kbd",
	"label",
	"legend",
	"li",
	"main",
	"nav",
	"ol",
	"option",
	"p",
	"pre",
	"progress",
	"section",
	"select",
	"small",
	"span",
	"strong",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"textarea",
	"tfoot",
	"th",
	"thead",
	"tr",
	"u",
	"ul",
	// SVG and MathML: tutuca's vdom puts what's under svg and math in their namespaces.
	...SVG_TAGS,
	...MATH_TAGS,
];
const ELEMENT = "(...args: unknown[]) => unknown";
// The view module: tutuca's tag functions and view constructors, as data that renders.
// $if and $query are when and query here: pure-js leaves names with $ to its compiler.
const viewModule = () => {
	const members = { button: ELEMENT, h: "(name: string, ...args: unknown[]) => unknown" };
	const impls = { "View.button": button, "View.h": V.h };
	for (const name of TAGS) {
		members[name] = ELEMENT;
		impls[`View.${name}`] = tag[name];
	}
	const fns = {
		field: ["(name: string) => unknown", V.field],
		send: ["(name: string, ...args: unknown[]) => unknown", V.send],
		targetValue: ["() => unknown", V.targetValue],
		sourceKey: ["() => unknown", V.sourceKey],
		dragKey: ["() => unknown", V.dragKey],
		eventKey: ["() => unknown", V.eventKey],
		eventProperty: ["(name: string) => unknown", V.eventProperty],
		when: ["(test: unknown, then: unknown, otherwise?: unknown) => unknown", V.$if],
		query: ["(name: string, ...args: unknown[]) => unknown", V.$query],
		each: ["(...args: unknown[]) => unknown", V.each],
		render: ["(...args: unknown[]) => unknown", V.render],
		renderEach: ["(...args: unknown[]) => unknown", V.renderEach],
		renderIt: ["(...args: unknown[]) => unknown", V.renderIt],
		pushView: ["(...args: unknown[]) => unknown", V.pushView],
		withBinds: ["(...args: unknown[]) => unknown", V.withBinds],
		lookupBind: ["(name: string) => unknown", V.lookupBind],
		provided: ["(name: string) => unknown", V.provided],
		seqItem: ["(...args: unknown[]) => unknown", V.seqItem],
	};
	for (const [name, [sig, impl]] of Object.entries(fns)) {
		members[name] = sig;
		impls[`View.${name}`] = impl;
	}
	return { members, impls };
};

// A literal's value, read from the tree: what a namespace's data says before anything runs.
const literal = (node) => {
	if (node === null || node === undefined) return undefined;
	switch (node.type) {
		case "Literal":
			return node.value;
		case "ArrayExpression":
			return node.elements.map(literal);
		case "ObjectExpression": {
			const out = {};
			for (const p of node.properties) {
				if (p.type !== "Property" || p.method || p.kind === "get" || p.computed) continue;
				out[p.key.type === "Identifier" ? p.key.name : String(p.key.value)] = literal(p.value);
			}
			return out;
		}
		case "UnaryExpression":
			return node.operator === "-" ? -literal(node.argument) : undefined;
		default:
			return undefined;
	}
};
const propertyOf = (obj, name) =>
	obj?.type === "ObjectExpression"
		? obj.properties.find(
				(p) =>
					p.type === "Property" &&
					!p.computed &&
					(p.key.type === "Identifier" ? p.key.name : String(p.key.value)) === name,
			)
		: undefined;

// The module's declarations: its type nodes by name, its namespaces' literals by name.
const declarationsOf = (module) => {
	const types = new Map();
	const namespaces = new Map();
	const consts = new Map();
	// The names declared with interface, not type.
	const interfaces = new Set();
	for (const item of module.items) {
		const d = item.type === "ExportNamedDeclaration" ? item.declaration : item;
		if (d.type === "TypeAlias") types.set(d.id.name, d.typeAnnotation);
		else if (d.type === "InterfaceDeclaration") {
			types.set(d.id.name, d.body);
			interfaces.add(d.id.name);
		} else if (d.type === "VariableDeclaration")
			for (const x of d.declarations) {
				if (isNamespaceLiteral(x.init)) namespaces.set(x.id.name, x.init);
				else consts.set(x.id.name, x.init);
			}
	}
	// What a component's data names of the module's constants is their value, as the module's
	// JavaScript has it: a constant, or a template of them, read as its literal.
	for (const init of [...namespaces.values(), ...consts.values()]) inlineConsts(init, consts);
	return { types, namespaces, consts, interfaces, imported: new Map() };
};
// The value a data node stands for when it names module constants (consts): a Literal node, or
// null when it isn't one.
const constLiteral = (node, consts, depth = 0) => {
	if (depth > 16 || node === null || node === undefined) return null;
	if (node.type === "Literal") return node;
	if (node.type === "Identifier" && consts.has(node.name))
		return constLiteral(consts.get(node.name), consts, depth + 1);
	if (node.type === "TemplateLiteral") {
		let text = "";
		for (const [i, q] of node.quasis.entries()) {
			text += q.value.cooked;
			if (i < node.expressions.length) {
				const part = constLiteral(node.expressions[i], consts, depth + 1);
				if (part === null || (typeof part.value !== "string" && typeof part.value !== "number"))
					return null;
				text += String(part.value);
			}
		}
		return { type: "Literal", value: text, start: node.start, end: node.end };
	}
	return null;
};
// The data of an object literal (not its methods, whose code reads constants as it runs), with
// the constants it names replaced by their literals.
const inlineConsts = (node, consts) => {
	if (node?.type === "ArrayExpression") {
		node.elements = node.elements.map((e) =>
			e?.type === "Identifier" || e?.type === "TemplateLiteral"
				? (constLiteral(e, consts) ?? e)
				: e,
		);
		for (const e of node.elements) inlineConsts(e, consts);
	} else if (node?.type === "ObjectExpression") {
		for (const p of node.properties) {
			if (p.type !== "Property" || p.method || p.kind !== "init") continue;
			if (p.value.type === "Identifier" || p.value.type === "TemplateLiteral")
				p.value = constLiteral(p.value, consts) ?? p.value;
			inlineConsts(p.value, consts);
		}
	}
};
// The members of a record type node: [name, member node], as written.
const membersOf = (node) => (node?.type === "TypeObject" ? node.members : []);
const isMarked = (m, marker) =>
	m.type === "TypeMethod" && m.result.type === "TypeRef" && m.result.name === marker;
// Whether name, declared with interface, is a component interface: not <C>Notifies or <C>Asks,
// which list a component's signals (a type is data).
const isInterfaceName = (interfaces, name) =>
	interfaces.has(name) && !name.endsWith("Notifies") && !name.endsWith("Asks");
// Whether a type of the module is a component interface: an interface declaration, but a
// component's own state type, which an interface of its name may share.
const isComponentInterface = (decl, name) =>
	isInterfaceName(decl.interfaces, name) && !componentsOf(decl).some((c) => c.name === name);

// A const object with a type of its name that says metaSchema: what components may say under
// the URI it gives (tutuca's registerMetaSchemas), its fields the type's, with defaults and
// constraints as a component's.
const metaSchemaUri = (init) => {
	const uri = literal(propertyOf(init, "metaSchema")?.value);
	return typeof uri === "string" ? uri : null;
};
const metaSchemasOf = (decl) =>
	[...decl.consts.entries()]
		.filter(([name, init]) => init?.type === "ObjectExpression" && decl.types.has(name))
		.filter(([, init]) => metaSchemaUri(init) !== null)
		.map(([name, literal]) => ({
			name,
			literal,
			state: decl.types.get(name),
			uri: metaSchemaUri(literal),
		}));
// Every component of the module: a namespace (or a const object, when it has no entries) with
// a state type of its name, but a meta schema.
const componentsOf = (decl) =>
	[
		...decl.namespaces.entries(),
		...[...decl.consts.entries()].filter(
			([, init]) => init?.type === "ObjectExpression" && metaSchemaUri(init) === null,
		),
	]
		.filter(([name]) => decl.types.has(name))
		.map(([name, literal]) => ({ name, literal, state: decl.types.get(name) }));
const queryNames = (c) => {
	const q = propertyOf(c.literal, "queries")?.value;
	return new Set(
		q?.type === "ObjectExpression"
			? q.properties.map((p) => (p.key.type === "Identifier" ? p.key.name : String(p.key.value)))
			: [],
	);
};
const handlerNames = (c, group) => {
	const on = propertyOf(c.literal, group)?.value;
	return on?.type === "ObjectExpression"
		? on.properties.map((p) => ({
				name: p.key.type === "Identifier" ? p.key.name : String(p.key.value),
				node: p.value,
			}))
		: [];
};
// A handler's args type: what its run's second parameter is annotated with, as TypeScript.
const argsText = (handlerNode) => fnArgsText(propertyOf(handlerNode, "run")?.value);
// A handler function's args type: its second parameter's annotation.
const fnArgsText = (fn) => {
	const p = fn?.params?.[1];
	// A run that takes only next takes nothing: run(next) is run(next, []).
	if (fn != null && p === undefined) return "[]";
	if (p?.typeAnnotation) return printNode(p.typeAnnotation, { types: true });
	// An empty pattern takes nothing.
	return p?.type === "ArrayPattern" && p.elements.length === 0 ? "[]" : "unknown[]";
};
// A handler's args, its run's (or answer outcome's) second parameter, are an array: an
// annotation that can't be one (run(next, n: number)) checks against what it says, but run
// gets [n], and the handler has no args a tool or a send can be typed by. What's wrong with
// each, as diagnostics.
const ARRAY_REFS = new Set(["Array", "ReadonlyArray"]);
// Whether type, an annotation, can't be an array: a keyword, a literal, an object type, or an
// alias of one. Anything it can't tell (a union, an import, a generic) may be one.
const notArray = (type, decl, seen = new Set()) => {
	switch (type?.type) {
		case "TypeKeyword":
			return !["any", "unknown", "never"].includes(type.name);
		case "TypeLiteral": // "x", 1, true
		case "TypeObject": // { ... }, an interface, a component's state
			return true;
		case "TypeRef": {
			if (ARRAY_REFS.has(type.name) || seen.has(type.name)) return false;
			const target = decl.types.get(type.name);
			return target !== undefined && notArray(target, decl, new Set([...seen, type.name]));
		}
		default:
			return false;
	}
};
const argsProblems = (comps, decl) => {
	const problems = [];
	const check = (fn, where) => {
		const p = fn?.params?.[1];
		if (p?.type !== "Identifier" || !notArray(p.typeAnnotation, decl)) return;
		const written = printNode(p.typeAnnotation, { types: true });
		problems.push({
			code: "pure-tutuca::handler-args",
			message: `${where}'s args are an array, not ${written}: run gets [${p.name}], not ${p.name}`,
			start: p.start,
			end: p.end,
			help: `destructure them with a tuple type: run(next, [${p.name}]: [${written}])`,
		});
	};
	for (const c of comps) {
		for (const h of handlerNames(c, "on")) {
			check(propertyOf(h.node, "run")?.value, `${c.name}.on.${h.name}`);
		}
		for (const h of handlerNames(c, "answers")) {
			for (const p of h.node?.type === "ObjectExpression" ? h.node.properties : []) {
				const key = p.key?.type === "Identifier" ? p.key.name : String(p.key?.value);
				const fn =
					p.value?.type === "FunctionExpression" ? p.value : propertyOf(p.value, "run")?.value;
				check(fn, `${c.name}.answers.${h.name}.${key}`);
			}
		}
	}
	return problems;
};
const ctxName = (component, message) =>
	`Ctx_${component}_${message.replace(/[^A-Za-z0-9_]/g, "_")}`;
const quoted = (names) =>
	names.length === 0 ? "string" : names.map((n) => JSON.stringify(n)).join(" | ");

// The pure-js host of a module's components: the standard host, the markers, the view module
// (tutuca/view), the tutuca module, a ctx handle for each handler, and the types the component
// modules it imports give it.
const buildHost = (decl, hostModules = []) => {
	const { members, impls } = viewModule();
	const comps = componentsOf(decl);
	const known = new Set([...comps.map((c) => c.name), ...decl.types.keys()]);
	const notifiesOf = (name) => membersOf(decl.types.get(`${name}Notifies`)).map((m) => m.name);
	const asksOf = (name) => membersOf(decl.types.get(`${name}Asks`)).map((m) => m.name);
	// [name made by, its type]: the components, the interfaces, the imported interfaces.
	const madeBy = [...known]
		.filter((n) => comps.some((c) => c.name === n) || isComponentInterface(decl, n))
		.map((n) => [n, n]);
	for (const [local, { name, interface: isIface }] of decl.imported)
		if (isIface && !madeBy.some(([n]) => n === name)) madeBy.push([name, local]);
	const makes = madeBy.map(
		([n, ty]) => `make(name: ${JSON.stringify(n)}, fields?: { [key: string]: unknown }): ${ty}`,
	);
	// An ask handler's last parameter, the asker's context: what it reads of the asker's scope.
	const handles = {
		AskCtx:
			"{ componentNames(walk?: boolean): string[]; metaOf(name: string, uri: string): unknown; log(value: unknown): void; now(): number; uuid(): string }",
	};
	const nondeterministic = ["AskCtx.uuid", "AskCtx.now"];
	for (const c of comps) {
		for (const group of ["on", "answers"]) {
			for (const h of handlerNames(c, group)) {
				const info = literal(h.node) ?? {};
				const sk = info.sourceKey?.keyOf !== undefined ? "number | undefined" : "unknown";
				// An answer's handle is its own: a message and an answer may share a name.
				const name = ctxName(c.name, group === "answers" ? `${h.name}Answer` : h.name);
				handles[name] =
					`{ readonly sourceKey: ${sk}; readonly drag: { type: string | null; value: unknown; key: number | string | null } | null; notify(name: ${quoted(notifiesOf(c.name))}, args?: unknown[]): void; ask(name: ${quoted(asksOf(c.name))}, args?: unknown[], options?: { detached?: boolean }): number; reply(name: string, args?: unknown[]): void; cancel(id: number): void; readonly request: number | null; stopNext(): void; uuid(): string; now(): number; log(value: unknown): void; tryMake(name: string, fields?: unknown): { ok: unknown; err?: undefined } | { ok?: undefined; err: { error: string; issues: unknown[] } }; componentNames(walk?: boolean): string[]; metaOf(name: string, uri: string): unknown; sendAt(name: string, args: unknown[], path: string | number | { item: string; key: number | string } | { seqItem: string; keyField: string } | (string | number | { item: string; key: number | string } | { seqItem: string; keyField: string })[], watch?: { settled?: string; progress?: string; timeout?: number; detached?: boolean }): number | undefined; ${makes.join("; ")} }`;
				nondeterministic.push(`${name}.uuid`, `${name}.now`);
			}
		}
		// init's ctx makes components, and nothing else.
		if (propertyOf(c.literal, "init") !== undefined)
			handles[ctxName(c.name, "init")] = `{ ${makes.join("; ")} }`;
	}
	// tutuca.apply: a component's pure messages, and an interface's methods marked Pure.
	const applies = [];
	const typed = [...decl.types, ...[...decl.imported].map(([local, { node }]) => [local, node])];
	for (const [name, node] of typed)
		for (const m of membersOf(node))
			if (isMarked(m, "Pure")) {
				const params = m.params.map((p) => `${p.name}: ${printNode(p.value, { types: true })}`);
				applies.push(
					`(component: ${name}, message: ${JSON.stringify(m.name)}${params.map((p) => `, ${p}`).join("")}) => ${name}`,
				);
			}
	for (const c of comps)
		for (const h of handlerNames(c, "on"))
			if (literal(propertyOf(h.node, "pure")?.value) === true) {
				const args = argsText(h.node);
				const tuple = args.startsWith("[") ? args.slice(1, -1).trim() : "";
				const params =
					tuple === "" ? [] : tuple.split(/,(?![^[{(]*[\]})])/).map((x, i) => `a${i}: ${x.trim()}`);
				applies.push(
					`(component: ${c.name}, message: ${JSON.stringify(h.name)}${params.map((p) => `, ${p}`).join("")}) => ${c.name}`,
				);
			}
	const tutuca = { errorMessage: "(error: unknown) => string" };
	if (applies.length > 0) tutuca.apply = applies;
	const page = pageDeclaration(hostModules);
	let host = null;
	host = stdHost.extend(
		{
			types: {
				Pure: "{ readonly pure: true }",
				Notify: "{ readonly notify: true }",
				// Any component: every one fits it, and nothing of it can be read.
				Component: "{}",
				...Object.fromEntries(
					[...decl.imported].map(([local, { node }]) => [local, printNode(node, { types: true })]),
				),
			},
			handles,
			modules: {
				View: members,
				tutuca,
				[dataDeclaration.module]: dataDeclaration.members,
				...page.modules,
			},
			imports: {
				[VIEW_SPEC]: "View",
				[dataDeclaration.specifier]: dataDeclaration.module,
				...page.imports,
			},
			nondeterministic,
			fresh: [...dataDeclaration.fresh, ...page.fresh],
		},
		{
			...impls,
			...dataImpls,
			...pageImpls(hostModules, () => host),
			"tutuca.apply": apply,
			"tutuca.errorMessage": errorMessage,
		},
	);
	return host;
};

// What each entry is, by path.
const signatures = (decl) => {
	const comps = new Map(componentsOf(decl).map((c) => [c.name, c]));
	return (path) => {
		const [name, group, member, fn] = path;
		const c = comps.get(name);
		if (c === undefined) return null;
		switch (group) {
			case "queries":
				return { this: read(name) };
			case "invariants":
			case "checks":
				return { this: read(name), result: "boolean" };
			case "on":
			case "answers": {
				const h = handlerNames(c, group).find((x) => x.name === member);
				if (h === undefined) return null;
				// An answer's outcome (answers.a.ok) is its handler, as run is.
				const outcome =
					group === "answers" && path.length === 4 ? propertyOf(h.node, fn)?.value : undefined;
				const args = outcome === undefined ? argsText(h.node) : fnArgsText(outcome);
				const pure = literal(propertyOf(h.node, "pure")?.value) === true;
				const ctx = ctxName(name, group === "answers" ? `${member}Answer` : member);
				// A swap's run gives what the component becomes (or nothing: it stays).
				const swap = literal(propertyOf(h.node, "swap")?.value) === true;
				if (fn === "run" || outcome !== undefined)
					return {
						this: read(name),
						params: pure ? [draft(name), args] : [draft(name), args, ctx],
						result: swap ? "unknown" : "void",
					};
				if (fn === "pre")
					return { this: read(name), params: [read(name), args, "unknown"], result: "boolean" };
				if (fn === "post")
					return {
						this: read(name),
						params: [read(name), read(name), args, "unknown"],
						result: "boolean",
					};
				return null;
			}
			case "init":
				return { this: read(name), params: [draft(name), ctxName(name, "init")], result: "void" };
			default:
				return { this: read(name) };
		}
	};
};

// What a namespace's data members are: C.defaults is the state's fields, each optional;
// C.examples start from such fields and expect fields and queries; C.on.m.changes and C.implements are names.
// The caller's meta namespaces: { [uri]: { schema, mode, problems, derive } }. schema is a
// shape (key -> type, as data or compiled) that what a component says under uri is checked
// against as it's written (a key with a default may be left out, at any depth); mode is
// "check" (checked when it's there), "require" (missing-meta when it isn't) or "derive" (made
// with derive(spec, said) when it isn't, and merged with it when it is: derived-meta, a
// warning); notes(spec, said, docs), with derive, what the derived meta lacks ([{ message,
// help }], derived-meta warnings too); problems(spec) says what the shape can't (a tool naming
// a message it hasn't).
const IDENT_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const keyText = (k) => (IDENT_KEY.test(k) ? k : JSON.stringify(k));
const parens = (text) => (/[|]/.test(text) ? `(${text})` : text);
const hasDefault = (type) => {
	let has = true;
	unlessNoDefault(
		() => type.make(undefined, null),
		() => {
			has = false;
		},
	);
	return has;
};
// A tutuca type as the TypeScript type meta is written as: a record's keys with a default are
// optional.
const metaTypeText = (type) => {
	if (type instanceof StringType) return "string";
	if (type instanceof NumberType || type instanceof IndexType) return "number";
	if (type instanceof BooleanType) return "boolean";
	if (type instanceof EnumType) return type.members.map((m) => JSON.stringify(m)).join(" | ");
	if (type instanceof OptionType) return `${parens(metaTypeText(type.valueType))} | null`;
	if (type instanceof ArrayType) return `${parens(metaTypeText(type.valueType))}[]`;
	if (type instanceof MapType) return `{ [key: string]: ${metaTypeText(type.valueType)} }`;
	if (type instanceof RecordType) return shapeText(type.shape);
	if (type instanceof OneOfType) return type.types.map((u) => parens(metaTypeText(u))).join(" | ");
	return "unknown";
};
const shapeText = (shape) => {
	const keys = Object.entries(shape);
	if (keys.length === 0) return "{}";
	const member = ([k, v]) => `${keyText(k)}${hasDefault(v) ? "?" : ""}: ${metaTypeText(v)}`;
	return `{ ${keys.map(member).join("; ")} }`;
};
const compiledShape = (schema) =>
	Object.values(schema).every((v) => v instanceof Type)
		? schema
		: compileShape(schema, undefined, "meta schema");
// The type text of each namespace's schema, by URI.
const metaTypesOf = (meta) =>
	Object.fromEntries(
		Object.entries(meta).map(([uri, { schema }]) => [uri, shapeText(compiledShape(schema))]),
	);
// Where a component says uri (the namespace's value), or where it would (its meta, or the
// component itself): what a meta diagnostic points at.
const metaNode = (c, uri) => {
	const meta = propertyOf(c.literal, "meta");
	return propertyOf(meta?.value, uri) ?? meta ?? c.literal;
};
const metaDiagnostic = (code, node, message, help = null) => ({
	code,
	stage: "check",
	message,
	start: node.start,
	end: node.type === "ObjectExpression" ? node.start + 1 : node.end,
	exclusion: null,
	profile: null,
	help,
});
// The doc tags derive reads (@summary, @param, @hidden) written after text on a line, where a
// doc comment takes them as text: /** Who is ahead. @summary */ says no summary. As warnings,
// one per doc comment, on the member it documents.
const DOC_TAGS = /(?:^|\s)@(summary|param|hidden)\b/;
const misplacedTags = (source, c) => {
	const out = [];
	const check = (node, what, span = node) => {
		if (node?.start === undefined) return;
		const doc = docAt(source, node.start);
		const tag = doc?.text?.match(DOC_TAGS)?.[1];
		if (tag === undefined) return;
		out.push(
			metaDiagnostic(
				"doc-tag",
				span,
				`${what}'s doc comment has @${tag} after text on its line, where it's read as text: it says nothing to the agent`,
				`start the tag on a line of its own, after the text: " * @${tag}${tag === "param" ? " n what n is" : ""}"`,
			),
		);
		out.at(-1).severity = "warning";
	};
	for (const group of ["on", "queries"]) {
		const node = propertyOf(c.literal, group)?.value;
		for (const p of node?.type === "ObjectExpression" ? node.properties : []) {
			const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			check(p, `${c.name}.${group}.${key}`, p.key);
		}
	}
	for (const m of membersOf(c.state)) check(m, `${c.name}.${m.name}`);
	return out;
};
// What c's doc comments say, for a namespace's derive: { text, fields, on, queries }. text is its
// type's doc (else its const's); fields each field's doc text; on and queries each handler's
// and query's { text, params, hidden, summary }, params its @param texts by name, hidden
// whether it says @hidden, summary whether it says @summary (on the query or its readonly
// member in the type).
const docsOf = (source, module, c) => {
	const at = (node) => (node?.start === undefined ? null : docAt(source, node.start));
	const declared = (kind) =>
		module.items.find((item) => {
			const d = item.declaration ?? item;
			if (kind === "type") return d.type === "TypeAlias" && d.id?.name === c.name;
			return d.type === "VariableDeclaration" && d.declarations?.[0]?.id?.name === c.name;
		});
	const read = (doc) => ({
		text: doc?.text ?? "",
		params: Object.fromEntries(
			(doc?.tags ?? []).filter((t) => t.tag === "param" && t.name).map((t) => [t.name, t.text]),
		),
		hidden: (doc?.tags ?? []).some((t) => t.tag === "hidden"),
		summary: (doc?.tags ?? []).some((t) => t.tag === "summary"),
	});
	const members = new Map(membersOf(c.state).map((m) => [m.name, m]));
	const queries = queryNames(c);
	const fields = {};
	for (const [name, m] of members) {
		if (!queries.has(name)) fields[name] = at(m)?.text ?? "";
	}
	const group = (name) => {
		const node = propertyOf(c.literal, name)?.value;
		const out = {};
		for (const p of node?.type === "ObjectExpression" ? node.properties : []) {
			const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			const own = read(at(p));
			// A query's doc may be on its readonly member in the type instead.
			const member = name === "queries" ? read(at(members.get(key))) : null;
			out[key] =
				member === null
					? own
					: {
							text: own.text || member.text,
							params: { ...member.params, ...own.params },
							hidden: own.hidden || member.hidden,
							summary: own.summary || member.summary,
						};
		}
		return out;
	};
	return {
		text: at(declared("type"))?.text || at(declared("const"))?.text || "",
		fields,
		on: group("on"),
		queries: group("queries"),
	};
};
// Whether c says something under uri.
const saysMeta = (c, uri) => propertyOf(propertyOf(c.literal, "meta")?.value, uri) !== undefined;
// The namespaces required and missing: missing-meta, before anything is compiled.
const missingMeta = (comps, meta) =>
	comps.flatMap((c) =>
		Object.entries(meta)
			.filter(([uri, { mode }]) => mode === "require" && !saysMeta(c, uri))
			.map(([uri]) =>
				metaDiagnostic(
					"missing-meta",
					metaNode(c, uri),
					`${c.name} says nothing under ${uri}, which is required here`,
					`add meta: { "${uri}": { ... } } to ${c.name}`,
				),
			),
	);

const dataTypes = (decl, metaTypes = {}) => {
	const comps = new Map([...componentsOf(decl), ...metaSchemasOf(decl)].map((c) => [c.name, c]));
	return (path) => {
		const c = comps.get(path[0]);
		if (c === undefined) return null;
		// What a component says under a namespace the caller gave a schema for.
		if (path.length === 3 && path[1] === "meta" && Object.hasOwn(metaTypes, path[2]))
			return metaTypes[path[2]];
		// Names: what a message changes, what a component implements.
		if (path.length === 4 && path[1] === "on" && path[3] === "changes") return "string[]";
		if (path.length === 2 && path[1] === "implements") return "string[]";
		if (path.length !== 2 || (path[1] !== "defaults" && path[1] !== "examples")) return null;
		const queries = queryNames(c);
		const fields = membersOf(c.state)
			.filter((m) => m.type === "TypeProperty" && !queries.has(m.name))
			.map((m) => `${m.name}?: ${printNode(m.value, { types: true })}`);
		const partial = fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
		// What an expect names: the fields and the queries.
		const readable = membersOf(c.state)
			.filter((m) => m.type === "TypeProperty")
			.map((m) => `${m.name}?: ${printNode(m.value, { types: true })}`);
		const expected = readable.length === 0 ? "{}" : `{ ${readable.join("; ")} }`;
		// An example: a start state, then messages to send and fields and queries to expect.
		return path[1] === "defaults"
			? partial
			: `{ [name: string]: { start?: ${partial}; steps: { send?: string; args?: unknown[]; expect?: ${expected} }[] } }`;
	};
};

// A type node as a tutuca type, as data: components (and interfaces) by name, aliases followed.
const toT = (node, decl, components, seen = new Set()) => {
	const to = (n) => toT(n, decl, components, seen);
	switch (node.type) {
		case "TypeKeyword":
			if (node.name === "number") return t.number();
			if (node.name === "string") return t.string();
			if (node.name === "boolean") return t.boolean();
			return t.any();
		case "TypeLiteral":
			return typeof node.value === "string" ? t.enum([node.value]) : t.any();
		case "TypeArray":
			return t.array(to(node.element));
		case "TypeReadonly":
			return to(node.operand);
		case "TypeUnion": {
			const rest = node.types.filter((u) => !(u.type === "TypeKeyword" && u.name === "null"));
			if (rest.length < node.types.length)
				return t.option(rest.length === 1 ? to(rest[0]) : to({ ...node, types: rest }));
			if (rest.every((u) => u.type === "TypeLiteral" && typeof u.value === "string"))
				return t.enum(rest.map((u) => u.value));
			// Components (or interfaces) by name: one component type, any of them, made as the
			// first by default.
			const types = rest.map(to);
			if (types.every((x) => x.type === "component" && typeof x.of === "string"))
				return t.component(types.map((x) => x.of));
			return t.oneOf(types);
		}
		case "TypeObject": {
			const index = node.members.find((m) => m.type === "TypeIndex");
			if (index) return t.map(to(index.value));
			const shape = {};
			for (const m of node.members)
				if (m.type === "TypeProperty" && !RESERVED.has(m.name)) shape[m.name] = to(m.value);
			return t.record(shape);
		}
		case "TypeRef": {
			if (components.has(node.name)) return t.component(node.name);
			// An imported interface, by the name it's registered as.
			const imported = decl.imported.get(node.name);
			if (imported !== undefined)
				return imported.interface
					? t.component(imported.name)
					: toT(imported.node, decl, components, seen);
			const aliased = decl.types.get(node.name);
			// The host's Component: any component.
			if (aliased === undefined && node.name === "Component") return t.component();
			if (aliased !== undefined && !seen.has(node.name)) {
				if (isComponentInterface(decl, node.name)) return t.component(node.name);
				return toT(aliased, decl, components, new Set([...seen, node.name]));
			}
			return t.any();
		}
		default:
			return t.any();
	}
};
// A field's type, constrained: its constraints are tutuca's options, by the same names; an
// option's are its value's (null meets them).
const CONSTRAINTS = ["int", "min", "max", "minLength", "maxLength", "pattern"];
const constrained = (type, c) => {
	if (c === undefined || c === null) return type;
	if (type.type === "option") return { ...type, of: constrained(type.of, c) };
	const out = { ...type };
	for (const key of CONSTRAINTS) if (c[key] !== undefined) out[key] = c[key];
	return out;
};
// The tutuca field types of a component: its state type's members that aren't queries.
const fieldsOf = (c, decl, components, data) => {
	const queries = queryNames(c);
	const fields = {};
	const order = [];
	for (const m of membersOf(c.state)) {
		if (m.type !== "TypeProperty" || queries.has(m.name) || RESERVED.has(m.name)) continue;
		const cons = data.constraints?.[m.name];
		const type = {
			...(cons?.keyOf !== undefined
				? t.index(cons.keyOf)
				: constrained(toT(m.value, decl, components), cons)),
		};
		if (data.defaults && Object.hasOwn(data.defaults, m.name)) type.default = data.defaults[m.name];
		if (data.sync?.[m.name] !== undefined) type.sync = data.sync[m.name];
		if (data.public?.includes(m.name)) type.public = true;
		fields[m.name] = type;
		order.push({ name: m.name, node: m.value, constraints: cons ?? null });
	}
	return { fields, order };
};

const ownDescriptors = (obj) => {
	const out = {};
	if (obj === undefined || obj === null) return out;
	for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(obj)))
		Object.defineProperty(out, k, d);
	return out;
};
const argsTypes = (text, decl, components) => {
	if (!text.startsWith("[")) return undefined;
	const node = parseModule(`type A = ${text};`).module?.items[0]?.typeAnnotation;
	return node?.type === "TypeTuple"
		? node.elements.map((e) => toT(e, decl, components))
		: undefined;
};

// A query property that reads as a field: a getter, or a method that takes no args (core's
// toQueries makes it a get query, as field() and this.name read it).
const isGetQuery = (p) =>
	p.kind === "get" || (p.value?.type === "FunctionExpression" && p.value.params.length === 0);

// queries with each call query (a method, not a getter) as { run, args, params }: its
// parameters' types and names, from their annotations, for checks and tools.
const callQueries = (c, queries, decl, components) => {
	const node = propertyOf(c.literal, "queries")?.value;
	const calls = {};
	for (const p of node?.type === "ObjectExpression" ? node.properties : []) {
		if (isGetQuery(p) || p.value?.type !== "FunctionExpression") continue;
		const name = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
		const ps = p.value.params ?? [];
		if (typeof queries[name] !== "function") continue;
		if (!ps.every((x) => x.type === "Identifier" && x.typeAnnotation)) continue;
		const text = `[${ps.map((x) => printNode(x.typeAnnotation, { types: true })).join(", ")}]`;
		calls[name] = {
			run: queries[name],
			args: argsTypes(text, decl, components),
			params: ps.map((x) => x.name),
		};
	}
	// A new object: the compiled one's members can't be redefined.
	const out = {};
	for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(queries))) {
		Object.defineProperty(out, k, k in calls ? { value: calls[k], enumerable: true } : d);
	}
	return out;
};

// The spec options of a component, from its namespace as compiled: what component() takes.
const specOptions = (c, ns, decl, components, data) => {
	const { fields } = fieldsOf(c, decl, components, data);
	const on = {};
	for (const h of handlerNames(c, "on")) {
		const entry = ns.on?.[h.name] ?? {};
		const info = literal(h.node) ?? {};
		const run = entry.run;
		// A handler's constraints are its arguments', by name, as a component's are its fields'.
		const names = (propertyOf(h.node, "run")?.value?.params?.[1]?.elements ?? []).map((e) =>
			e?.type === "Identifier" ? e.name : null,
		);
		const args = argsTypes(argsText(h.node), decl, components)?.map((type, i) => {
			const cons = info.constraints?.[names[i]];
			if (cons?.keyOf === undefined) return constrained(type, cons);
			return type.type === "option" ? t.option(t.index(cons.keyOf)) : t.index(cons.keyOf);
		});
		// The args' names, as run destructures them, when every one is a plain name.
		const params =
			args !== undefined && names.length === args.length && names.every((n) => n !== null)
				? names
				: undefined;
		on[h.name] = {
			...(args === undefined ? {} : { args }),
			...(params === undefined ? {} : { params }),
			pure: info.pure === true,
			swap: info.swap === true,
			...(info.why === undefined ? {} : { why: info.why }),
			...(entry.pre === undefined ? {} : { pre: entry.pre }),
			...(entry.post === undefined ? {} : { post: entry.post }),
			run,
		};
	}
	// An ask's answers: each outcome (ok, error, unhandled) a handler, as run, with tutuca's ctx.
	const answers = {};
	for (const h of handlerNames(c, "answers")) answers[h.name] = { ...ns.answers?.[h.name] };
	return {
		name: c.name,
		fields,
		queries: callQueries(c, ownDescriptors(ns.queries), decl, components),
		on,
		answers,
		invariants: ns.invariants ?? {},
		...(ns.view === undefined ? {} : { view: ns.view }),
		...(ns.views === undefined ? {} : { views: ns.views }),
		...(ns.renders === undefined ? {} : { renders: ns.renders }),
		...(ns.meta === undefined ? {} : { meta: ns.meta }),
		...(ns.implements === undefined ? {} : { implements: [...ns.implements] }),
		...(ns.provides === undefined ? {} : { provides: { ...ns.provides } }),
		...(ns.binds === undefined ? {} : { binds: ownDescriptors(ns.binds) }),
		...(ns.loops === undefined ? {} : { loops: ns.loops }),
		...(ns.init === undefined ? {} : { init: ns.init }),
	};
};

// The model, format 2: what the shared corpus records and any other loader must also give.
const modelOf = (decl, comps, components, checked) => {
	const typeText = (node) => printNode(node, { types: true });
	const entries = new Map(checked.entries.map((e) => [e.path.join("."), e.returnType]));
	return {
		format: 2,
		components: comps.map((c) => {
			const data = literal(c.literal) ?? {};
			const { order } = fieldsOf(c, decl, components, data);
			return {
				name: c.name,
				fields: order.map((f) => ({
					name: f.name,
					type: typeText(f.node),
					constraints: f.constraints,
					default:
						data.defaults && Object.hasOwn(data.defaults, f.name) ? data.defaults[f.name] : null,
					sync: data.sync?.[f.name] ?? null,
					public: data.public?.includes(f.name) ?? false,
				})),
				queries: [...queryNames(c)].map((q) => ({
					name: q,
					type: entries.get(`${c.name}.queries.${q}`) ?? null,
				})),
				messages: handlerNames(c, "on").map((h) => {
					const info = literal(h.node) ?? {};
					return {
						name: h.name,
						args: argsText(h.node),
						pure: info.pure === true,
						changes: info.changes ?? null,
						constraints: info.constraints ?? null,
						sourceKey: info.sourceKey ?? null,
						pre: propertyOf(h.node, "pre") !== undefined,
						post: propertyOf(h.node, "post") !== undefined,
						why: info.why ?? null,
					};
				}),
				invariants: handlerNames(c, "invariants").map((h) => h.name),
				views: [
					...(propertyOf(c.literal, "view") ? ["main"] : []),
					...handlerNames(c, "views").map((h) => h.name),
				],
				meta: data.meta ?? null,
				implements: data.implements ?? [],
			};
		}),
		interfaces: [...decl.types.entries()]
			.filter(([name]) => isComponentInterface(decl, name))
			.map(([name, node]) => ({
				name,
				fields: membersOf(node)
					.filter((m) => m.type === "TypeProperty")
					.map((m) => ({ name: m.name, type: typeText(m.value) })),
				messages: membersOf(node)
					.filter((m) => isMarked(m, "Pure"))
					.map((m) => ({
						name: m.name,
						args: `[${m.params.map((p) => typeText(p.value)).join(", ")}]`,
						pure: true,
					})),
				notifies: membersOf(node)
					.filter((m) => isMarked(m, "Notify"))
					.map((m) => m.name),
			})),
		metaSchemas: metaSchemasOf(decl).map((m) => {
			const data = literal(m.literal) ?? {};
			return {
				name: m.name,
				uri: m.uri,
				fields: fieldsOf(m, decl, components, data).order.map((f) => ({
					name: f.name,
					type: typeText(f.node),
					constraints: f.constraints,
					default:
						data.defaults && Object.hasOwn(data.defaults, f.name) ? data.defaults[f.name] : null,
				})),
			};
		}),
		register: literal(decl.consts.get("register")) ?? null,
		entries: Object.fromEntries(entries),
	};
};

// A module's imports of other component modules (a specifier ending in .tutuca): the types they
// name, local name -> { name, node }, and the module's other items. Only types are imported.
const isComponentSpecifier = (spec) => /\.tutuca(\.ts)?$/.test(spec);
const componentImports = (module, resolve) => {
	const types = new Map();
	const diagnostics = [];
	const problem = (node, message) =>
		diagnostics.push({ code: "pure-tutuca::import", message, start: node.start, end: node.end });
	const items = module.items.filter((item) => {
		if (item.type !== "ImportDeclaration" || !isComponentSpecifier(item.source.value)) return true;
		const spec = item.source.value;
		const path = spec.endsWith(".ts") ? spec : `${spec}.ts`;
		if (item.importKind !== "type") {
			problem(
				item.source,
				`a component module is imported for its types: import type { ... } from "${path}"`,
			);
			return false;
		}
		const text = typeof resolve === "function" ? resolve(spec) : null;
		const other = typeof text === "string" ? parseModule(text).module : null;
		if (other === null) {
			problem(item.source, `can't read ${path}`);
			return false;
		}
		const theirs = declarationsOf(other);
		for (const sp of item.specifiers) {
			const node = theirs.types.get(sp.imported.name);
			if (node === undefined) problem(sp.imported, `${path} declares no type ${sp.imported.name}`);
			else
				types.set(sp.local.name, {
					name: sp.imported.name,
					node,
					interface: isInterfaceName(theirs.interfaces, sp.imported.name),
				});
		}
		return false;
	});
	return { items, types, diagnostics };
};

// What componentModule gives for a module that doesn't check: its diagnostics and nothing made.
const failed = (diagnostics, model = null) => ({
	ok: false,
	diagnostics,
	warnings: [],
	components: {},
	examples: {},
	interfaces: {},
	metaSchemas: {},
	askHandlers: {},
	hostAsks: [],
	model,
});
// Checks and compiles a pure-tutuca module into what the header says.
export const componentModule = (
	source,
	{ resolve = null, deterministic = false, hostModules = [], meta = {} } = {},
) => {
	const parsed = parseModule(source);
	if (parsed.module === null) return failed(parsed.diagnostics);
	// The component modules it imports are tutuca's to read, not pure-js's (whose modules share
	// one namespace of types): their types are the host's, by local name.
	const imports = componentImports(parsed.module, resolve);
	if (imports.diagnostics.length > 0) return failed(imports.diagnostics);
	parsed.module = { ...parsed.module, items: imports.items };
	const decl = declarationsOf(parsed.module);
	decl.imported = imports.types;
	const comps = componentsOf(decl);
	const argsWrong = argsProblems(comps, decl);
	if (argsWrong.length > 0) return failed(argsWrong);
	const components = new Set(comps.map((c) => c.name));
	const host = buildHost(decl, hostModules);
	const options = {
		host,
		resolve,
		signatureOf: signatures(decl),
		dataTypeOf: dataTypes(decl, metaTypesOf(meta)),
		deterministic,
	};
	const checked = verifyModule(parsed.module, options);
	if (checked.diagnostics.length > 0) return failed(checked.diagnostics);
	const missing = missingMeta(comps, meta);
	if (missing.length > 0) return failed(missing);
	const model = modelOf(decl, comps, components, checked);
	const compiled = compileModule(parsed.module, options);
	if (!compiled.ok) return failed(compiled.diagnostics, model);
	const specs = {};
	const warnings = [];
	const problems = [];
	for (const c of comps) {
		const ns = compiled.namespaces[c.name] ?? compiled.consts[c.name];
		const opts = specOptions(c, ns, decl, components, literal(c.literal) ?? {});
		let spec = component(opts);
		// What the caller's namespaces derive, over what it said, and what's wrong with it.
		for (const [uri, { mode, derive, notes, problems: problemsOf }] of Object.entries(meta)) {
			if (mode === "derive" && typeof derive === "function") {
				const said = saysMeta(c, uri) ? spec.meta[uri] : null;
				const docs = docsOf(source, parsed.module, c);
				warnings.push(...misplacedTags(source, c));
				const derived = derive(spec, said, docs);
				// What the namespace says the derived meta lacks (notes(spec, said, docs)).
				for (const note of notes?.(spec, said, docs) ?? []) {
					const d = metaDiagnostic("derived-meta", metaNode(c, uri), note.message, note.help);
					warnings.push({ ...d, severity: "warning" });
				}
				spec = component({ ...opts, meta: { ...opts.meta, [uri]: derived } });
				opts.meta = spec.meta;
				warnings.push(
					metaDiagnostic(
						"derived-meta",
						metaNode(c, uri),
						said === null
							? `${c.name}'s ${uri} meta is derived from its definition`
							: `${c.name}'s ${uri} meta is what it says over what its definition derives`,
					),
				);
			}
			if (typeof problemsOf !== "function" || !Object.hasOwn(spec.meta ?? {}, uri)) continue;
			for (const message of problemsOf(spec))
				problems.push(metaDiagnostic("meta-problem", metaNode(c, uri), `${c.name}: ${message}`));
		}
		specs[c.name] = spec;
	}
	if (problems.length > 0) return failed(problems, model);
	// Each component's examples, as data, with where each is in the source: what checks run.
	const examples = {};
	for (const c of comps) {
		const node = propertyOf(c.literal, "examples")?.value;
		if (node?.type !== "ObjectExpression") continue;
		examples[c.name] = node.properties
			.filter((p) => p.type === "Property" && !p.computed)
			.map((p) => {
				const data = literal(p.value) ?? {};
				return {
					name: p.key.type === "Identifier" ? p.key.name : String(p.key.value),
					start: data.start ?? {},
					steps: Array.isArray(data.steps) ? data.steps : [],
					at: { start: p.key.start, end: p.key.end },
				};
			});
	}
	// The interfaces, as registerInterfaces takes them: an interface's methods marked Pure are
	// its pure messages, those marked Notify its notifies.
	const interfaces = {};
	for (const [name, node] of decl.types) {
		if (!isComponentInterface(decl, name)) continue;
		const ms = membersOf(node);
		const argsOf = (m) => m.params.map((p) => toT(p.value, decl, components));
		interfaces[name] = iface({
			pure: Object.fromEntries(
				ms.filter((m) => isMarked(m, "Pure")).map((m) => [m.name, argsOf(m)]),
			),
			notifies: Object.fromEntries(
				ms.filter((m) => isMarked(m, "Notify")).map((m) => [m.name, argsOf(m)]),
			),
		});
	}
	// The meta schemas, as registerMetaSchemas takes them: URI -> key -> type.
	const metaSchemas = {};
	for (const m of metaSchemasOf(decl))
		metaSchemas[m.uri] = fieldsOf(m, decl, components, literal(m.literal) ?? {}).fields;
	// The asks the module answers (askHandlers.a(...args) gives a's answer now), as
	// scope.registerAskHandlers takes them, and the ones it leaves to the host (hostAsks).
	const askHandlers = {};
	const asks = compiled.namespaces.askHandlers ?? compiled.consts.askHandlers ?? {};
	// An ask handler's parameters are the ask's arguments, then the asker's context (AskCtx).
	for (const name of Object.keys(asks)) askHandlers[name] = (args, ctx) => asks[name](...args, ctx);
	const hostAsks = [...(literal(decl.consts.get("hostAsks")) ?? [])];
	return {
		ok: true,
		diagnostics: [],
		// What it says that doesn't stop it: derived-meta.
		warnings,
		components: specs,
		examples,
		interfaces,
		metaSchemas,
		askHandlers,
		hostAsks,
		model,
	};
};

// What a component module is before any backend compiles it: its text as pure-js reads it,
// the host it is checked against (as a declaration, plain data), every entry's signature and
// every data member's type by path, its model, and each component's definition as data (what
// component() takes, without its functions). A runtime that compiles the module itself
// (tutuca-wasm, with pure-js's WebAssembly backend) starts from this, so both runtimes read a
// module the same way.
export const componentModuleSource = (
	source,
	{ resolve = null, deterministic = false, hostModules = [] } = {},
) => {
	const parsed = parseModule(source);
	if (parsed.module === null) return { ok: false, diagnostics: parsed.diagnostics };
	const imports = componentImports(parsed.module, resolve);
	if (imports.diagnostics.length > 0) return { ok: false, diagnostics: imports.diagnostics };
	// The component modules it imports are read here for their types; pure-js doesn't see them.
	let text = source;
	for (const item of parsed.module.items) {
		if (imports.items.includes(item)) continue;
		text = text.slice(0, item.start) + " ".repeat(item.end - item.start) + text.slice(item.end);
	}
	parsed.module = { ...parsed.module, items: imports.items };
	const decl = declarationsOf(parsed.module);
	decl.imported = imports.types;
	const comps = componentsOf(decl);
	const argsWrong = argsProblems(comps, decl);
	if (argsWrong.length > 0) return failed(argsWrong);
	const components = new Set(comps.map((c) => c.name));
	const host = buildHost(decl, hostModules);
	const signatureOf = signatures(decl);
	const dataTypeOf = dataTypes(decl);
	const checked = verifyModule(parsed.module, {
		host,
		resolve,
		signatureOf,
		dataTypeOf,
		deterministic,
	});
	if (checked.diagnostics.length > 0) return { ok: false, diagnostics: checked.diagnostics };
	const model = modelOf(decl, comps, components, checked);
	const mode = (e) => (typeof e === "string" ? e : `${e.mode} ${e.type}`);
	const entries = {};
	for (const e of checked.entries) {
		const sig = signatureOf(e.path);
		if (sig === null) continue;
		entries[e.path.join(".")] = {
			...(sig.this === undefined ? {} : { this: mode(sig.this) }),
			...(sig.params === undefined ? {} : { params: sig.params.map(mode) }),
			...(sig.result === undefined ? {} : { result: mode(sig.result) }),
		};
	}
	const data = {};
	const typed = (path) => {
		const type = dataTypeOf(path);
		if (type !== null) data[path.join(".")] = type;
	};
	const definitions = {};
	for (const c of [...comps, ...metaSchemasOf(decl)]) {
		typed([c.name, "defaults"]);
		typed([c.name, "examples"]);
		typed([c.name, "implements"]);
		for (const h of handlerNames(c, "on")) typed([c.name, "on", h.name, "changes"]);
	}
	const kindsOf = (c, group) => {
		const node = propertyOf(c.literal, group)?.value;
		const out = {};
		for (const p of node?.type === "ObjectExpression" ? node.properties : []) {
			const name = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			out[name] = p.kind === "get" || (group === "queries" && isGetQuery(p)) ? "get" : "call";
		}
		return out;
	};
	// The arguments of each query that takes some, named and typed: what a host calls it with.
	const queryArgsOf = (c) => {
		const node = propertyOf(c.literal, "queries")?.value;
		const out = {};
		for (const p of node?.type === "ObjectExpression" ? node.properties : []) {
			if (isGetQuery(p)) continue;
			const name = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			out[name] = (p.value?.params ?? []).map((q) => ({
				name: q.name,
				type: q.typeAnnotation ? toT(q.typeAnnotation, decl, components) : t.any(),
			}));
		}
		return out;
	};
	for (const c of comps) {
		const info = literal(c.literal) ?? {};
		const { fields } = fieldsOf(c, decl, components, info);
		const on = {};
		for (const h of handlerNames(c, "on")) {
			const meta = literal(h.node) ?? {};
			const names = (propertyOf(h.node, "run")?.value?.params?.[1]?.elements ?? []).map((e) =>
				e?.type === "Identifier" ? e.name : null,
			);
			const args = argsTypes(argsText(h.node), decl, components)?.map((type, i) => {
				const cons = meta.constraints?.[names[i]];
				if (cons?.keyOf === undefined) return constrained(type, cons);
				return type.type === "option" ? t.option(t.index(cons.keyOf)) : t.index(cons.keyOf);
			});
			on[h.name] = {
				...(args === undefined ? {} : { args, names }),
				pure: meta.pure === true,
				swap: meta.swap === true,
				pre: propertyOf(h.node, "pre") !== undefined,
				post: propertyOf(h.node, "post") !== undefined,
				why: propertyOf(h.node, "why") !== undefined,
				...(meta.sourceKey === undefined ? {} : { sourceKey: meta.sourceKey }),
				...(meta.changes === undefined ? {} : { changes: meta.changes }),
			};
		}
		const answers = {};
		for (const h of handlerNames(c, "answers")) {
			answers[h.name] = (h.node.properties ?? []).map((p) =>
				p.key.type === "Identifier" ? p.key.name : String(p.key.value),
			);
		}
		definitions[c.name] = {
			name: c.name,
			fields,
			queries: kindsOf(c, "queries"),
			queryArgs: queryArgsOf(c),
			on,
			answers,
			invariants: handlerNames(c, "invariants").map((h) => h.name),
			init: propertyOf(c.literal, "init") !== undefined,
			implements: info.implements ?? [],
			provides: info.provides ?? {},
			meta: info.meta ?? null,
			loops: Object.keys(kindsOf(c, "loops")),
			binds: Object.keys(kindsOf(c, "binds")),
			views: [
				...(propertyOf(c.literal, "view") ? ["main"] : []),
				...handlerNames(c, "views").map((h) => h.name),
			],
		};
	}
	return {
		ok: true,
		diagnostics: [],
		source: text,
		host: host.describe(),
		entries,
		data,
		model,
		definitions,
		interfaces: [...decl.types.keys()].filter((name) => isComponentInterface(decl, name)),
		// Its meta schemas, by URI: each key's type, as data.
		metaSchemas: Object.fromEntries(
			metaSchemasOf(decl).map((m) => [
				m.uri,
				fieldsOf(m, decl, components, literal(m.literal) ?? {}).fields,
			]),
		),
		// What the host modules a module's code calls do, by qualified name: tutuca/data, the page's
		// (their results checked against their declared types), tutuca.errorMessage.
		impls: {
			...dataImpls,
			...pageImpls(hostModules, () => host),
			"tutuca.errorMessage": errorMessage,
		},
		hostAsks: [...(literal(decl.consts.get("hostAsks")) ?? [])],
	};
};
