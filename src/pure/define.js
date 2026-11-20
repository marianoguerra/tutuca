// Components defined while an app runs: a pure-tutuca module's source checked against the scope
// it would go in, registered there, and, when it gives a name that's already there a new
// definition, the live instances of that name moved onto it with their state. Structured data
// only: what people (or agents) read is define-text.js's.
//
// checkComponentSource never touches the scope it checks against: the components are checked
// and made in a scope of their own below it. defineComponentSource registers them, and gives the
// state root holds made again through the new definitions when one overrides a name.
// componentAsks makes both asks any component can declare, each in the asker's scope.

import { lineColumn } from "pure-js";
import { Scope } from "../core/model/scope.js";
import { scopeOf, specOf } from "../core/model/spec.js";
import { lint } from "../lint/index.js";
import { project } from "../sync/codec.js";
import { rebuild } from "../sync/migrate.js";
import { idOf, idSym, isNode } from "../tree/identity.js";
import { componentModule } from "./module.js";

// A diagnostic as the reports have it: where it is as lines and columns (1-based), the line it
// starts on, and what pure-js says about it. A tutuca one (component, view, path) has no place
// in the source: its line is null.
const NOWHERE = {
	start: null,
	end: null,
	line: null,
	column: null,
	endLine: null,
	endColumn: null,
	sourceLine: null,
};
const diagnostic = (fields) => ({
	severity: "error",
	code: "",
	stage: "",
	message: "",
	...NOWHERE,
	help: null,
	exclusion: null,
	profile: null,
	component: null,
	view: null,
	path: null,
	...fields,
});
const located = (d, source) => {
	const start = d.start ?? 0;
	const end = d.end ?? start;
	const from = lineColumn(source, start);
	const to = lineColumn(source, end);
	return diagnostic({
		code: d.code,
		// An import's problem is tutuca's, found before pure-js reads the module.
		stage: d.stage ?? "import",
		message: d.message,
		start,
		end,
		line: from.line,
		column: from.column,
		endLine: to.line,
		endColumn: to.column,
		sourceLine: source.split("\n")[from.line - 1] ?? "",
		help: d.help ?? null,
		exclusion: d.exclusion ?? null,
		profile: d.profile ?? null,
	});
};
// A lint issue: an error where the view can't work as written, a warning where it may not do
// what it says.
const linted = (issue) =>
	diagnostic({
		severity: issue.level === "error" ? "error" : "warning",
		code: issue.code,
		stage: "lint",
		message: issue.message,
		component: issue.component,
		view: issue.view,
		path: issue.path,
	});

// The specs registered in scope and its parents that a lookup from scope finds: what the new
// components see.
const inReach = (scope) => {
	const specs = new Map();
	for (const s of scope.ancestors()) {
		for (const name in s.specs) if (!specs.has(name)) specs.set(name, s.specs[name]);
	}
	return specs;
};

// Compiles source and checks what it gives against scope: { report, components }, components
// the module's specs by name ({} when it doesn't compile).
const inspect = (source, scope, options) => {
	const fail = (diagnostics) => ({
		report: { ok: false, components: [], replaces: [], shadows: [], diagnostics },
		components: {},
	});
	let compiled;
	try {
		compiled = componentModule(source, options);
	} catch (error) {
		// component() rejects what the module says (a view it can't build, ...).
		return fail([diagnostic({ code: "component", stage: "build", message: error.message })]);
	}
	if (!compiled.ok) return fail(compiled.diagnostics.map((d) => located(d, source)));
	const { components } = compiled;
	const names = Object.keys(components);
	if (names.length === 0) {
		return fail([
			diagnostic({
				code: "no-components",
				stage: "build",
				message: "the module defines no component",
				help: "export a type and a const of the same name: export type Card = {...}; export const Card = {...}",
			}),
		]);
	}
	// What the compiler says that doesn't stop it (derived-meta): notes, where they are.
	const diagnostics = (compiled.warnings ?? []).map((d) => ({
		...located(d, source),
		severity: "note",
	}));
	// A scope of its own, below the one it goes in: registering there checks what registering in
	// scope would (interfaces, meta), and making each with its defaults what adding one would.
	const trial = new Scope(() => {}, scope, "check");
	trial.registerInterfaces(compiled.interfaces);
	trial.registerMetaSchemas(compiled.metaSchemas);
	for (const name of names) {
		try {
			trial.register({ [name]: components[name] });
		} catch (error) {
			diagnostics.push(
				diagnostic({
					code: "register",
					stage: "register",
					message: error.message,
					component: name,
				}),
			);
		}
	}
	for (const name of names) {
		if (!Object.hasOwn(trial.specs, name)) continue;
		const made = trial.tryMake(name, {});
		if (made.err !== undefined) {
			diagnostics.push(
				diagnostic({
					code: "make",
					stage: "make",
					message: made.err.error,
					component: name,
					help: "every field needs a default to make one with no fields given: add it to defaults",
				}),
			);
		}
	}
	const reach = inReach(trial);
	const mine = new Set(names);
	for (const issue of lint(new Set(reach.values()), new Set(reach.keys()))) {
		if (mine.has(issue.component) && reach.get(issue.component) === components[issue.component]) {
			diagnostics.push(linted(issue));
		}
	}
	const ok = diagnostics.every((d) => d.severity !== "error");
	return {
		report: {
			ok,
			components: names,
			replaces: names.filter((name) => Object.hasOwn(scope.specs, name)),
			shadows: names.filter(
				(name) => !Object.hasOwn(scope.specs, name) && scope.lookupSpec(name) !== null,
			),
			diagnostics,
		},
		components,
		compiled,
	};
};

// What source would register in scope, and what's wrong with it: { ok, components, replaces,
// shadows, diagnostics }. ok when no diagnostic is an error (warnings don't stop a define);
// components the names it defines, replaces those registered in scope already (a new
// definition), shadows those a lookup finds above it (one of its own, here). Changes nothing.
export const checkComponentSource = (source, scope, options = {}) =>
	inspect(source, scope, options).report;

// next with the identities prev has at the same places, where both hold a component of the
// same name: the nodes a define made again are the ones that were there, so what's on its way
// to them (an answer, a watch) still reaches them.
const keepIdentities = (next, prev) => {
	if (next === null || typeof next !== "object") return next;
	if (next instanceof Set) return next;
	if (next instanceof Map) {
		const was = prev instanceof Map ? prev : null;
		return new Map([...next].map(([k, v]) => [k, keepIdentities(v, was?.get(k))]));
	}
	const out = Array.isArray(next) ? [] : Object.create(Object.getPrototypeOf(next));
	for (const key of Object.keys(next)) out[key] = keepIdentities(next[key], prev?.[key]);
	for (const sym of Object.getOwnPropertySymbols(next)) out[sym] = next[sym];
	if (isNode(next) && isNode(prev) && specOf(next)?.name === specOf(prev)?.name) {
		out[idSym] = idOf(prev);
	}
	return Object.isFrozen(next) ? Object.freeze(out) : out;
};

// Registers what source defines in scope, when it checks: { ok, scope, registered, replaced,
// shadowed, root, added, reset, dropped, diagnostics, components }, scope its path from the
// root ("" for the root). When it gives a name a lookup already finds a new definition (one
// registered there, replaced, or above it, shadowed), root (the state, a host's root) is made again through it (sync's rebuild,
// as a hot reload does): root is the new state, added, reset and dropped what didn't carry as
// it was (paths from the root). root is null when nothing was overridden. When the state can't
// be made again, what was registered is put back and ok is false.
export const defineComponentSource = (source, scope, root = null, options = {}) => {
	const { report, components, compiled } = inspect(source, scope, options);
	const where = scopePath(scope);
	const none = {
		scope: where,
		registered: [],
		replaced: [],
		shadowed: [],
		root: null,
		added: [],
		reset: [],
		dropped: [],
	};
	if (!report.ok) return { ...none, ok: false, diagnostics: report.diagnostics, components: {} };
	const names = report.components;
	const replaced = report.replaces;
	const shadowed = report.shadows;
	// Projected before registering: once a name is another spec, a ref to the old one can't be
	// written.
	const carryFailed = (error) =>
		diagnostic({
			code: "carry",
			stage: "carry",
			message: `the app's state can't be made with the new definition: ${error.message}`,
			help: "a field the old definition didn't have needs a default",
		});
	let plain = null;
	try {
		const changes = replaced.length + shadowed.length > 0;
		if (changes && root !== null) plain = project(root, { level: "none" });
	} catch (error) {
		const failed = carryFailed(error);
		return { ...none, ok: false, diagnostics: [...report.diagnostics, failed], components: {} };
	}
	const before = Object.fromEntries(
		names.map((name) => [name, Object.hasOwn(scope.specs, name) ? scope.specs[name] : undefined]),
	);
	const putBack = () => {
		for (const name of names) {
			if (before[name] === undefined) delete scope.specs[name];
			else scope.specs[name] = before[name];
		}
	};
	try {
		scope.registerInterfaces(compiled.interfaces);
		scope.registerMetaSchemas(compiled.metaSchemas);
		scope.register(components);
	} catch (error) {
		putBack();
		const failed = diagnostic({ code: "register", stage: "register", message: error.message });
		return { ...none, ok: false, diagnostics: [...report.diagnostics, failed], components: {} };
	}
	let carried = { root: null, added: [], reset: [], dropped: [] };
	if (plain !== null) {
		try {
			const rebuilt = rebuild(plain, scope.root);
			carried = { ...rebuilt, root: keepIdentities(rebuilt.root, root) };
		} catch (error) {
			putBack();
			const failed = carryFailed(error);
			return { ...none, ok: false, diagnostics: [...report.diagnostics, failed], components: {} };
		}
	}
	return {
		ok: true,
		scope: where,
		registered: names,
		replaced,
		shadowed,
		...carried,
		diagnostics: report.diagnostics,
		components,
	};
};

// A scope's path from the root, "" for the root.
const scopePath = (scope) => scope.path.join("/");

// Every component in value, at any depth: [{ path, instance }], path its keys from value.
export const instancesIn = (value) => {
	const found = [];
	const walk = (v, path) => {
		if (v === null || typeof v !== "object") return;
		if (specOf(v) !== undefined && specOf(v) !== null) found.push({ path, instance: v });
		if (v instanceof Map) {
			for (const [k, x] of v) walk(x, [...path, k]);
			return;
		}
		if (v instanceof Set) return;
		for (const key of Object.keys(v)) walk(v[key], [...path, Array.isArray(v) ? Number(key) : key]);
	};
	walk(value, []);
	return found;
};
const isUnder = (scope, ancestor) => {
	for (const s of scope?.ancestors() ?? []) if (s === ancestor) return true;
	return false;
};

// The scopes below scope, each with the components registered in it and how many of each root
// holds: [{ name, path, components: [{ name, live }] }], by name.
export const listScopes = (scope, root = null) => {
	const live = instancesIn(root);
	return Object.keys(scope.children)
		.sort()
		.map((name) => {
			const child = scope.children[name];
			return {
				name,
				path: scopePath(child),
				components: Object.keys(child.specs)
					.sort()
					.map((c) => ({
						name: c,
						live: live.filter(({ instance }) => specOf(instance) === child.specs[c]).length,
					})),
			};
		});
};
// The scope below scope that name says, a path ("a/b"), or null.
const childAt = (scope, name) => {
	let s = scope;
	for (const key of String(name).split("/")) {
		s = s.children[key];
		if (s === undefined) return null;
	}
	return s;
};
// unregisterComponent's and removeScope's answers: { ok, name, scope, error, inUse }, name the
// component ("" for a scope), scope the path below the asker's, inUse the paths that hold it.
const removal = (name, scope, error = "", inUse = []) => ({
	ok: error === "",
	name,
	scope,
	error,
	inUse: inUse.map(({ path }) => path),
});

// Takes the component name off the scope below scope at path (scope itself for ""), unless
// root holds one of it.
export const unregisterComponent = (scope, name, path = "", root = null) => {
	const at = path === "" ? scope : childAt(scope, path);
	if (at === null) return removal(name, path, `there's no scope ${path} here`);
	if (!Object.hasOwn(at.specs, name)) {
		return removal(
			name,
			path,
			`there's no component ${name} in ${path === "" ? "this scope" : path}`,
		);
	}
	const spec = at.specs[name];
	const inUse = instancesIn(root).filter(({ instance }) => specOf(instance) === spec);
	if (inUse.length > 0) return removal(name, path, `${name} is in use`, inUse);
	delete at.specs[name];
	return removal(name, path);
};
// Takes the scope below scope at path away, with the scopes below it, unless root holds a
// component made in one of them.
export const removeScope = (scope, path, root = null) => {
	const at = childAt(scope, path);
	if (at === null) return removal("", path, `there's no scope ${path} here`);
	const inUse = instancesIn(root).filter(({ instance }) => isUnder(scopeOf(instance), at));
	if (inUse.length > 0) return removal("", path, `${path} is in use`, inUse);
	delete at.parent.children[at.name];
	return removal("", path);
};

// The asks a component can declare (emits: { ask: [...] }) to define components and manage the
// scopes below its own, each in the asker's scope; a scope argument is a path below it ("" or
// null for the asker's own), which defineComponent makes when it isn't there:
//   checkComponent([source, scope]): checkComponentSource's report
//   defineComponent([source, scope]): defineComponentSource's answer, without root and components
//   listScopes([]): listScopes'
//   unregisterComponent([name, scope]) and removeScope([scope]): { ok, error, inUse }
// defineComponent gives host the state made again when it overrides or shadows a name, and calls
// onDefine(specs, scope) with what it registered (to compile their classes, say). host may be a
// function that gives it, for handlers made before the host is.
export const componentAsks = ({ host = null, onDefine = null, options = {} } = {}) => {
	const hostOf = typeof host === "function" ? host : () => host;
	const rootOf = () => hostOf()?.root ?? null;
	const below = (scope, path, make) => {
		if (path === null || path === undefined || path === "") return scope;
		if (!make) return childAt(scope, path);
		return String(path)
			.split("/")
			.reduce((s, key) => s.enter(key), scope);
	};
	return {
		checkComponent: ([source, path = null], read) =>
			checkComponentSource(source, below(read.scope, path, false) ?? read.scope, options),
		defineComponent: ([source, path = null], read) => {
			const live = hostOf();
			let scope;
			try {
				scope = below(read.scope, path, true);
			} catch (error) {
				const failed = diagnostic({ code: "scope", stage: "register", message: error.message });
				return {
					ok: false,
					scope: String(path),
					registered: [],
					replaced: [],
					shadowed: [],
					added: [],
					reset: [],
					dropped: [],
					diagnostics: [failed],
				};
			}
			const { root, components, ...answer } = defineComponentSource(
				source,
				scope,
				live?.root ?? null,
				options,
			);
			if (answer.ok) {
				onDefine?.(Object.values(components), scope);
				if (root !== null) live.applyChange(() => root);
			}
			return answer;
		},
		listScopes: (_args, read) => listScopes(read.scope, rootOf()),
		unregisterComponent: ([name, path = ""], read) =>
			unregisterComponent(read.scope, name, path ?? "", rootOf()),
		removeScope: ([path], read) => removeScope(read.scope, path, rootOf()),
	};
};
