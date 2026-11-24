// The components defined at runtime as pure-tutuca sources (a component editor, a module dropped
// on the page, ...), kept by ref so a sync engine can share them: what's defined here goes to
// the peers, and what peers define is registered here, once it checks. Structured data only;
// the engine decides how the entries are stored (automerge.js keeps them in its document).
//
// An entry is { ref, source }: ref the scope's path and the component's name ("Counter" at the
// root, "editor/Counter" below it), source the module that defines it. A module defining two
// components is two entries with the same source: each registers only its own.
//
// Registering what peers send runs their code here: the registry can't be made without
// dangerouslyRegisterExternalComponents: true. Only pure-tutuca sources are accepted (the
// checked JS subset, with no access to the page), and of a module only the components with no
// errors or warnings are registered.
//
// A sync engine calls receive(entries) with every entry it holds, as often as it likes: the
// registry acts on what changed since the last call (a new or changed source registers, a
// missing ref is removed), so a removal is the entry's absence. It writes what's defined here
// through subscribe(fn): fn({ op: "put", ref, source }) or fn({ op: "delete", ref }), one entry
// each, so a peer's removal is never undone by writing back what this one holds.

import { project } from "../sync/codec.js";
import { rebuild } from "../sync/migrate.js";
import { checkComponentSource, defineComponentSource } from "./define.js";

const refOf = (path, name) => (path === "" ? name : `${path}/${name}`);
const splitRef = (ref) => {
	const keys = ref.split("/");
	return { path: keys.slice(0, -1).join("/"), name: keys.at(-1) };
};
// The diagnostics that stop name, a component of a received module, from registering: errors
// and warnings of the module as a whole (no component) or of name.
const issuesOf = (report, name) =>
	report.diagnostics.filter(
		(d) => d.severity !== "note" && (d.component === null || d.component === name),
	);

// host: a Host, or a function that gives it (for a registry made before the host is). options:
// componentModule's (meta, ...), as componentAsks takes them. onDefine(specs, scope): what
// componentAsks' does, for the components peers define. onReport(event): { type: "registered",
// ref }, { type: "rejected", ref, diagnostics }, { type: "removed", ref }, { type: "failed",
// ref, error }. shares(path): whether definitions in the scope at path are shared (a preview's
// scratch scope may not be).
export const definitionsRegistry = ({
	host,
	dangerouslyRegisterExternalComponents = false,
	options = {},
	onDefine = null,
	onReport = null,
	shares = () => true,
} = {}) => {
	if (dangerouslyRegisterExternalComponents !== true) {
		throw new Error(
			"definitionsRegistry registers components other peers send, running their code here: " +
				"pass dangerouslyRegisterExternalComponents: true to allow it",
		);
	}
	const hostOf = typeof host === "function" ? host : () => host;
	const known = new Map(); // ref -> source: what the registry and the engine agree on
	const subscribers = new Set();
	const emit = (change) => {
		for (const fn of subscribers) fn(change);
	};
	const report = (event) => onReport?.(event);
	const scopeAt = (path) =>
		path === ""
			? hostOf().scope.root
			: path.split("/").reduce((s, key) => s.enter(key), hostOf().scope.root);

	// A peer's entry: checked where it goes, and only its own component registered, when nothing
	// is wrong with it.
	const register = (ref, source) => {
		const { path, name } = splitRef(ref);
		const scope = scopeAt(path);
		const check = checkComponentSource(source, scope, options);
		const issues = check.components.includes(name)
			? issuesOf(check, name)
			: [{ severity: "error", message: `the source doesn't define ${name}` }];
		if (issues.length > 0) return report({ type: "rejected", ref, diagnostics: issues });
		const live = hostOf();
		const answer = defineComponentSource(source, scope, live.root ?? null, {
			...options,
			only: [name],
		});
		if (!answer.ok) return report({ type: "rejected", ref, diagnostics: answer.diagnostics });
		onDefine?.(Object.values(answer.components), scope);
		if (answer.root !== null) live.applyChange(() => answer.root);
		report({ type: "registered", ref });
	};
	// A peer removed it: what's made of it here is kept as it was, an UnknownComponent, until
	// it's defined again.
	const remove = (ref) => {
		const { path, name } = splitRef(ref);
		const live = hostOf();
		const root = live.scope.root;
		const scope = path === "" ? root : path.split("/").reduce((s, k) => s?.children[k], root);
		if (scope === undefined || !Object.hasOwn(scope.specs, name)) return;
		const plain = live.root === null ? null : project(live.root, { level: "none" });
		delete scope.specs[name];
		if (plain !== null) live.applyChange(() => rebuild(plain, root).root);
		report({ type: "removed", ref });
	};

	return {
		// The entries the registry knows, by ref.
		entries: () => new Map(known),
		subscribe(fn) {
			subscribers.add(fn);
			return () => subscribers.delete(fn);
		},
		// From the engine: every entry it holds, as a Map or { ref: source }.
		receive(entries) {
			const next = new Map(entries instanceof Map ? entries : Object.entries(entries ?? {}));
			for (const [ref, source] of next) {
				if (known.get(ref) === source) continue;
				known.set(ref, source);
				try {
					register(ref, source);
				} catch (error) {
					report({ type: "failed", ref, error });
				}
			}
			for (const ref of [...known.keys()]) {
				if (next.has(ref)) continue;
				known.delete(ref);
				try {
					remove(ref);
				} catch (error) {
					report({ type: "failed", ref, error });
				}
			}
		},
		// From what defines components here (componentAsks): path the scope's from the root.
		defined(path, names, source) {
			if (!shares(path)) return;
			for (const name of names) {
				const ref = refOf(path, name);
				if (known.get(ref) === source) continue;
				known.set(ref, source);
				emit({ op: "put", ref, source });
			}
		},
		removed(path, name) {
			const ref = refOf(path, name);
			if (!known.delete(ref)) return;
			emit({ op: "delete", ref });
		},
		// A scope taken away, with the ones below it.
		scopeRemoved(path) {
			for (const ref of [...known.keys()]) {
				if (ref.startsWith(`${path}/`)) {
					known.delete(ref);
					emit({ op: "delete", ref });
				}
			}
		},
	};
};
