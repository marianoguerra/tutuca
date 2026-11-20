// Compiling: a checked program to a JavaScript function. The tree is erased (types go),
// lowered (indexing goes through the runtime's guards) and audited (every name is the
// program's or the host's, no property reaches the machinery), then printed and compiled with
// new Function, the host's values as its parameters, so the function has nothing else in
// scope. The audit doesn't trust the checker: it holds for any tree the sieve let through.

import { boundNames, erase, eraseModule, itemDeclaration, walk } from "./ast.js";
import { check } from "./check.js";
import { Diagnostic } from "./diagnostic.js";
import { verifyModule } from "./module.js";
import { parse, parseModule } from "./parse.js";
import { print, printFunction } from "./print.js";
import { runtime } from "./runtime.js";
import { sieve } from "./sieve.js";
import { MODULE_ONLY_NAMES, RESERVED_NAMES } from "./tables.js";

const RESERVED = new Set([...RESERVED_NAMES]);
const MODULE_ONLY = new Set(MODULE_ONLY_NAMES);
const RUNTIME = "$pure";

// parse, sieve and check: { program, diagnostics, returnType }. unchecked skips the check,
// for the tests that show the audit and the runtime's guards hold without it.
export const verify = (
	source,
	{ host, signature = null, profile = "core", deterministic = false, unchecked = false } = {},
) => {
	const parsed = typeof source === "string" ? parse(source) : { program: source, diagnostics: [] };
	if (parsed.diagnostics.length > 0)
		return { program: null, diagnostics: parsed.diagnostics, returnType: null };
	const program = parsed.program;
	const sieved = sieve(program, { profile });
	if (sieved.diagnostics.length > 0)
		return { program, diagnostics: sieved.diagnostics, returnType: null };
	if (unchecked) return { program, diagnostics: [], returnType: null };
	const checked = check(program, { host, signature, deterministic });
	return { program, diagnostics: checked.diagnostics, returnType: checked.returnType };
};

const runtimeCall = (name, args, at) => ({
	type: "CallExpression",
	start: at.start,
	end: at.end,
	callee: {
		type: "MemberExpression",
		object: { type: "Identifier", name: RUNTIME },
		property: { type: "Identifier", name },
		computed: false,
		optional: false,
	},
	arguments: args,
	optional: false,
});

// x[k] reads as $pure.get(x, k), x[k] = v sets as $pure.set(x, k, v).
export const lower = (node) => {
	if (node === null || typeof node !== "object") return node;
	if (Array.isArray(node)) return node.map(lower);
	if (
		node.type === "AssignmentExpression" &&
		node.left.type === "MemberExpression" &&
		node.left.computed
	) {
		if (node.operator !== "=") throw new Error("only = assigns to an indexed place");
		return runtimeCall(
			"set",
			[lower(node.left.object), lower(node.left.property), lower(node.right)],
			node,
		);
	}
	if (node.type === "MemberExpression" && node.computed) {
		if (node.optional) throw new Error("optional indexing isn't compiled");
		return runtimeCall("get", [lower(node.object), lower(node.property)], node);
	}
	// for-of walks a snapshot, so a body that adds to the list still ends.
	if (node.type === "ForOfStatement")
		return {
			...node,
			left: lower(node.left),
			right: runtimeCall("snapshot", [lower(node.right)], node.right),
			body: lower(node.body),
		};
	const out = {};
	for (const [k, v] of Object.entries(node))
		out[k] = k === "value" && node.type !== "Property" ? v : lower(v);
	return out;
};

// The names a lowered tree uses that it doesn't bind, and the problems the audit finds.
export const audit = (fn, hostNames) => {
	const bound = new Set([RUNTIME, "undefined"]);
	walk(fn, (n) => {
		if (
			n.type === "FunctionExpression" ||
			n.type === "ArrowFunctionExpression" ||
			n.type === "FunctionDeclaration"
		)
			for (const p of n.params) for (const name of boundNames(p)) bound.add(name);
		if (n.type === "FunctionDeclaration") bound.add(n.id.name);
		if (n.type === "ImportSpecifier") bound.add(n.local.name);
		if (n.type === "VariableDeclarator") for (const name of boundNames(n.id)) bound.add(name);
	});
	const used = new Set();
	const problems = [];
	walk(fn, (n, parent, key) => {
		if (n.type === "Identifier") {
			if (parent?.type === "MemberExpression" && key === "property" && !parent.computed) return;
			if (parent?.type === "Property" && key === "key" && !parent.computed) return;
			if (parent?.type === "FunctionExpression" && key === "id") return;
			if (parent?.type === "FunctionDeclaration" && key === "id") return;
			if (parent?.type === "ImportSpecifier") return;
			if (n.name.startsWith("$") && n.name !== RUNTIME)
				problems.push(`the name ${n.name} is the compiler's`);
			if (bound.has(n.name)) return;
			if (hostNames.has(n.name)) used.add(n.name);
			else problems.push(`${n.name} is neither bound by the program nor provided by the host`);
		}
		if (n.type === "MemberExpression" && !n.computed) {
			const name = n.property.name;
			if (RESERVED.has(name)) problems.push(`the property ${name} is reserved`);
			if (
				MODULE_ONLY.has(name) &&
				!(
					n.object.type === "Identifier" &&
					hostNames.has(n.object.name) &&
					!bound.has(n.object.name)
				)
			)
				problems.push(`only a module's member may be called ${name}`);
		}
		if (n.type === "Property" && !n.computed) {
			const name = n.key.type === "Identifier" ? n.key.name : String(n.key.value);
			if (RESERVED.has(name)) problems.push(`the key ${name} is reserved`);
		}
		// The sieve lets an arrow be the callback of xs.map(...) and the like; a host module's
		// member that happens to be called map is not a list method.
		if (
			n.type === "ArrowFunctionExpression" &&
			parent?.type === "CallExpression" &&
			parent.callee.type === "MemberExpression" &&
			parent.callee.object.type === "Identifier" &&
			hostNames.has(parent.callee.object.name) &&
			!bound.has(parent.callee.object.name)
		)
			problems.push("a callback is given only to a list method");
		if (
			n.type === "MemberExpression" &&
			n.object.type === "Identifier" &&
			n.object.name === RUNTIME &&
			!(parent?.type === "CallExpression" && key === "callee")
		)
			problems.push(`${RUNTIME} is only called`);
	});
	return { used, problems };
};

// Compiles source (or a parsed program): { ok, diagnostics, fn, code }. fn is the program as
// a function, to call with this and the signature's arguments; code is what was compiled.
export const compile = (source, options = {}) => {
	const { host } = options;
	const verified = verify(source, options);
	if (verified.diagnostics.length > 0)
		return { ok: false, diagnostics: verified.diagnostics, fn: null, code: null };
	const program = verified.program;
	const lowered = lower(erase(program.function));
	const hostNames = new Set(host.names());
	const { used, problems } = audit(lowered, hostNames);
	if (problems.length > 0) {
		const diagnostics = problems.map(
			(message) =>
				new Diagnostic({
					code: "audit",
					stage: "compile",
					message,
					start: program.start,
					end: program.end,
				}),
		);
		return { ok: false, diagnostics, fn: null, code: null };
	}
	const text = printFunction({ ...program, function: lowered });
	const names = [...used].sort();
	const code = `"use strict";\nreturn (${text});`;
	// Compiling the printed, audited tree, with nothing in scope but the host's names.
	const factory = new Function(...names, RUNTIME, code);
	const fn = factory(...names.map((n) => host.value(n)), runtime);
	return { ok: true, diagnostics: [], fn, code, returnType: verified.returnType };
};

const ident = (name) => ({ type: "Identifier", name });
const memberOf = (object, name) => ({
	type: "MemberExpression",
	object,
	property:
		typeof name === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
			? ident(name)
			: { type: "Literal", value: name },
	computed: !(typeof name === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)),
	optional: false,
});
const IMPORTS = "$imports";
// The host modules a module imports from by specifier, by name: apart from the parameters
// named as the host's modules, which the module's own declarations may shadow.
const HOSTS = "$hosts";

// Compiles a module (source or tree): { ok, diagnostics, namespaces, consts, exports, entries,
// code }. The module's checked tree is erased, lowered and audited, then printed as one
// function body that makes its constants (frozen) and returns its namespaces, whose methods
// and getters are the entries; it has the host's modules and functions as its parameters (in a
// block of its own, so a declaration of the module shadows one, as it would a global), the host
// modules it imports from as $hosts, and what other modules export (compiled the same way) as
// $imports.
export const compileModule = (source, options = {}) => {
	const { host, resolve = null } = options;
	const cache = options.cache ?? new Map();
	const parsed =
		typeof source === "string" ? parseModule(source) : { module: source, diagnostics: [] };
	if (parsed.module === null) return { ok: false, diagnostics: parsed.diagnostics };
	const checked = verifyModule(parsed.module, options);
	if (checked.diagnostics.length > 0) return { ok: false, diagnostics: checked.diagnostics };
	const module = parsed.module;
	const imports = {};
	for (const item of module.items) {
		const d = itemDeclaration(item);
		if (d.type !== "ImportDeclaration" || d.importKind === "type") continue;
		const spec = d.source.value;
		if (host.imports.has(spec) || spec in imports) continue;
		if (!cache.has(spec)) {
			const sub = compileModule(resolve(spec), { ...options, signatureOf: () => null, cache });
			if (!sub.ok) return sub;
			cache.set(spec, sub);
		}
		imports[spec] = cache.get(spec).exports;
	}
	const lowered = lower(eraseModule(module));
	const hostNames = new Set(host.names());
	const { used, problems } = audit(lowered, hostNames);
	const importedHosts = new Set();
	if (problems.length > 0)
		return {
			ok: false,
			diagnostics: problems.map(
				(message) =>
					new Diagnostic({
						code: "audit",
						stage: "compile",
						message,
						start: module.start,
						end: module.end,
					}),
			),
		};
	// The module as statements of a function body: an import is a const naming what it imports,
	// a const is frozen, an export is remembered.
	const items = [];
	const exported = [];
	const namespaces = [];
	const consts = [];
	for (const item of lowered.items) {
		const d = itemDeclaration(item);
		if (item.type === "ExportNamedDeclaration")
			exported.push(
				...(d.type === "FunctionDeclaration" ? [d.id.name] : d.declarations.map((x) => x.id.name)),
			);
		if (d.type === "ImportDeclaration") {
			const spec = d.source.value;
			const hostModule = host.imports.get(spec);
			if (hostModule !== undefined) importedHosts.add(hostModule);
			const from =
				hostModule !== undefined
					? memberOf(ident(HOSTS), hostModule)
					: memberOf(ident(IMPORTS), spec);
			for (const sp of d.specifiers)
				items.push({
					type: "VariableDeclaration",
					kind: "const",
					declarations: [
						{
							type: "VariableDeclarator",
							id: ident(sp.local.name),
							init: memberOf(from, sp.imported.name),
						},
					],
				});
			continue;
		}
		if (d.type === "VariableDeclaration") {
			for (const x of d.declarations) {
				(isNamespace(x.init) ? namespaces : consts).push(x.id.name);
				items.push({
					type: "VariableDeclaration",
					kind: "const",
					declarations: [
						{
							...x,
							init: {
								type: "CallExpression",
								callee: memberOf(ident(RUNTIME), "freeze"),
								arguments: [x.init],
								optional: false,
							},
						},
					],
				});
			}
			continue;
		}
		items.push(d);
	}
	const body = print({ type: "PureModule", items });
	const ret = `return { namespaces: ${printRecord(namespaces)}, consts: ${printRecord(consts)}, exports: ${printRecord(exported)} };`;
	const names = [...used].sort();
	const code = `"use strict";\n{\n${body}\n${ret}\n}`;
	const hosts = Object.freeze(
		Object.fromEntries([...importedHosts].sort().map((n) => [n, host.value(n)])),
	);
	const factory = new Function(...names, RUNTIME, IMPORTS, HOSTS, code);
	const made = factory(...names.map((n) => host.value(n)), runtime, Object.freeze(imports), hosts);
	return {
		ok: true,
		diagnostics: [],
		...made,
		entries: checked.entries,
		types: checked.types,
		code,
	};
};
const printRecord = (names) => (names.length === 0 ? "{}" : `{ ${names.join(", ")} }`);
const isNamespace = (e) =>
	e?.type === "ObjectExpression" &&
	e.properties.some(
		(p) => p.type === "Property" && (p.method || p.kind === "get" || isNamespace(p.value)),
	);
