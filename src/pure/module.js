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
// The same text is what tutuca-wax compiles (spec/pure-tutuca/README.md). The module is checked
// and compiled with pure-js; the components are ordinary component() specs; model is format 2,
// what the shared conformance corpus records.
//
//   const { ok, components, interfaces, metaSchemas, askHandlers, hostAsks, diagnostics, model } =
//     componentModule(source, { resolve, hostModules });
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
import { t } from "../core/model/types.js";
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
	if (p?.typeAnnotation) return printNode(p.typeAnnotation, { types: true });
	// An empty pattern takes nothing.
	return p?.type === "ArrayPattern" && p.elements.length === 0 ? "[]" : "unknown[]";
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
const dataTypes = (decl) => {
	const comps = new Map([...componentsOf(decl), ...metaSchemasOf(decl)].map((c) => [c.name, c]));
	return (path) => {
		const c = comps.get(path[0]);
		if (c === undefined) return null;
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

// The spec options of a component, from its namespace as compiled.
const specOf = (c, ns, decl, components, data) => {
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
		on[h.name] = {
			...(args === undefined ? {} : { args }),
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
	return component({
		name: c.name,
		fields,
		queries: ownDescriptors(ns.queries),
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
	});
};

// The model, format 2: what the shared corpus records and tutuca-wax's compiler must also give.
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
	components: {},
	interfaces: {},
	metaSchemas: {},
	askHandlers: {},
	hostAsks: [],
	model,
});
// Checks and compiles a pure-tutuca module into what the header says.
export const componentModule = (
	source,
	{ resolve = null, deterministic = false, hostModules = [] } = {},
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
	const components = new Set(comps.map((c) => c.name));
	const host = buildHost(decl, hostModules);
	const options = {
		host,
		resolve,
		signatureOf: signatures(decl),
		dataTypeOf: dataTypes(decl),
		deterministic,
	};
	const checked = verifyModule(parsed.module, options);
	if (checked.diagnostics.length > 0) return failed(checked.diagnostics);
	const model = modelOf(decl, comps, components, checked);
	const compiled = compileModule(parsed.module, options);
	if (!compiled.ok) return failed(compiled.diagnostics, model);
	const specs = {};
	for (const c of comps) {
		const ns = compiled.namespaces[c.name] ?? compiled.consts[c.name];
		specs[c.name] = specOf(c, ns, decl, components, literal(c.literal) ?? {});
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
		components: specs,
		interfaces,
		metaSchemas,
		askHandlers,
		hostAsks,
		model,
	};
};
