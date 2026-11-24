// tutuca-wasm for a page: loads the runtime (WebAssembly), compiles component modules with
// pure-js's WebAssembly backend, and wires the two together.
//
//   const tutuca = await createRuntime();
//   tutuca.load(source);                  // a pure-tutuca module: checked, compiled, registered
//   tutuca.start("Counter", { count: 1 });
//   tutuca.send("inc");
//   tutuca.state();                       // { count: 2, step: 1 }
//
// What runs here, in JavaScript, is the linking and what a compiled module asks of its host:
// the methods of strings and numbers, the standard host, tutuca/data and the page's own modules.
// The state, the components' code and the runtime are WebAssembly.

import { componentModuleSource } from "../../src/pure/module.js";
import { load as loadPureJs, withDirectives } from "../dist/pure-js/pure-js.js";
import { compileBytes, Fail, Instance } from "../dist/pure-js/pure-js-run.js";

// Where the two WebAssembly modules are when nobody says: beside this file, built by build.sh.
// A page that bundles this file says where it put them.
const RUNTIME = new URL("../dist/tutuca-wasm.wasm", import.meta.url);
const COMPILER = new URL("../dist/pure-js/pure-js.wasm", import.meta.url);

// A file's bytes: read from disk under Node, fetched in a page.
async function bytesOf(url) {
	if (url.protocol === "file:") {
		const fs = "node:fs/promises";
		return (await import(fs)).readFile(url);
	}
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response.arrayBuffer();
}

// What the runtime changes the page with, as tutuca's own vdom does (src/vdom/index.js): the
// nodes it makes are marked owned, and only those are ever looked at or moved.
const NEVER_ASSIGN = new Set(
	"width height href list form tabIndex download rowSpan colSpan role popover".split(" "),
);
const PROP_ATTR_NAME = { className: "class", htmlFor: "for" };
function setProp(node, name, value, namespaced) {
	if (name === "dangerouslySetInnerHTML") {
		if (value === undefined) node.replaceChildren();
		else {
			const html = value?.__html ?? "";
			if (html !== node.innerHTML) node.innerHTML = html;
		}
		return;
	}
	const usesProp = !namespaced && !NEVER_ASSIGN.has(name) && name in node;
	if (usesProp && value != null) {
		try {
			node[name] = value;
			return;
		} catch {}
	}
	if (value == null || (value === false && name[4] !== "-")) {
		if (usesProp) {
			try {
				node[name] = "";
			} catch {}
			node.removeAttribute(PROP_ATTR_NAME[name] ?? name);
		} else node.removeAttribute(name);
	} else node.setAttribute(name, value);
}
function domImports(document, rootNode, fromValue) {
	const owned = new WeakSet();
	const own = (node) => {
		owned.add(node);
		return node;
	};
	const ownedChildren = (parent) => Array.from(parent.childNodes).filter((n) => owned.has(n));
	// The owned children snapshot last took, read one by one by snapshot_child.
	let snapshot = [];
	const nextOwned = (node) => {
		let next = node.nextSibling;
		while (next !== null && !owned.has(next)) next = next.nextSibling;
		return next;
	};
	return {
		element(tag, ns, is) {
			const options = is === "" ? undefined : { is };
			return own(
				ns === ""
					? document.createElement(tag, options)
					: document.createElementNS(ns, tag, options),
			);
		},
		text: (text) => own(document.createTextNode(text)),
		comment: (text) => own(document.createComment(text)),
		set_prop: (node, name, value, namespaced) =>
			setProp(node, name, fromValue(value), namespaced !== 0),
		apply_value(node, value, namespaced) {
			const v = fromValue(value);
			if (node.tagName === "PROGRESS" && (v == null || v === 0)) node.removeAttribute("value");
			else setProp(node, "value", v, namespaced !== 0);
		},
		set_data(node, text) {
			node.data = text;
		},
		append: (parent, child) => parent.appendChild(child),
		insert_before: (parent, node, before, atEnd) =>
			parent.insertBefore(node, atEnd ? null : before),
		remove: (parent, node) => parent.removeChild(node),
		replace: (parent, node, old) => parent.replaceChild(node, old),
		parent: (node) => node.parentNode,
		snapshot(parent) {
			snapshot = ownedChildren(parent);
			return snapshot.length;
		},
		snapshot_child: (i) => snapshot[i],
		next_is: (node, other, atEnd) => nextOwned(node) === (atEnd ? null : other),
		root: () => rootNode,
		clone: (node) => node.cloneNode(true),
		own,
		first_child: (node) => node.firstChild,
		next_sibling: (node) => node.nextSibling,
		clear: (node) => node.replaceChildren(),
		survives_clone(node, name) {
			if (!(name in node)) return 1;
			const a = node[name];
			const b = node.cloneNode(false)[name];
			return a === b || (typeof a === "object" && a !== null && String(a) === String(b)) ? 1 : 0;
		},
	};
}

// What an event's target is in: the comments that open what encloses it and the elements with
// event bindings, from the target up to the root's node, as tutuca's own decoding reads them
// (src/core/host/events.js). null when the target isn't under the root.
const MARKER_CLOSE = "§/§";
function* enclosingMarkers(node) {
	let closed = 0;
	for (let n = node.previousSibling; n; n = n.previousSibling) {
		if (n.nodeType !== 8) continue;
		const data = n.data;
		if (data === MARKER_CLOSE) {
			closed++;
			continue;
		}
		if (!(data.startsWith("§{") && data.endsWith("§"))) continue;
		if (closed > 0) {
			closed--;
			continue;
		}
		let marker;
		try {
			marker = JSON.parse(data.slice(1, -1));
		} catch {
			continue;
		}
		if (marker?.t === "component" || marker?.t === "frame") yield marker;
	}
}
function walkUp(target, rootNode) {
	const markers = [];
	const components = []; // Where in markers each component around the target starts.
	const eids = [];
	const nodes = []; // The element of each of eids.
	let node = target;
	while (node && node !== rootNode) {
		const eid = node.getAttribute?.("data-eid");
		if (eid != null) {
			const value = node.type === "checkbox" ? node.checked : (node.value ?? null);
			eids.push({ eid: Number.parseInt(eid, 10), level: components.length, value });
			nodes.push(node);
		}
		for (const marker of enclosingMarkers(node)) {
			if (marker.t === "component") components.push(markers.length);
			markers.push(marker);
		}
		node = node.parentNode;
	}
	return node === rootNode && components.length > 0 ? { markers, components, eids, nodes } : null;
}
const HELD = ["ctrlKey", "altKey", "shiftKey", "metaKey"];
const DROP_EVENTS = new Set(["dragenter", "dragover", "dragleave", "drop"]);
const DRAG_EVENTS = ["dragstart", "dragend", ...DROP_EVENTS];

const browserEnv = { now: () => Date.now(), uuid: () => globalThis.crypto.randomUUID() };

/**
 * A tutuca runtime in WebAssembly, with no components yet. env gives what handlers read of the
 * world; with a document and a rootNode, mount() shows the root there. asks answers the asks no
 * module's ask handler does, by name: (args) => the answer, or a promise of it. runtime and
 * compiler are the URLs of tutuca-wasm.wasm and pure-js.wasm, for a page that keeps them elsewhere.
 */
export async function createRuntime({
	env = browserEnv,
	document = null,
	rootNode = null,
	asks = {},
	runtime = RUNTIME,
	compiler = COMPILER,
} = {}) {
	const purejs = await loadPureJs(compiler);
	// Any compiled module has the value functions; the smallest program gives them to the runtime.
	const seed = purejs.analyze("() => 0");
	const seeded = new Instance(await compileBytes(seed.compiled.bytes));
	const values = seeded.exports;
	const entries = new Map(); // An entry's path -> the function of the module that has it.
	let modules = 0;
	let entryError = "";
	let rt = null;
	let event = null; // The event being handled, for what its handler's arguments read of it.
	const listening = new Set();
	let askValue = null; // What an ask answered now gave, for the runtime to take.
	const waiting = new Set(); // The asks answered later.
	const imports = {
		values: {},
		tutuca: {
			entry(path, self, args) {
				const f = entries.get(path);
				if (f === undefined) {
					entryError = `there is no entry ${path}`;
					return values.v_const(0);
				}
				const given = [];
				for (let i = 0; i < f.length - 1; i++) {
					given.push(i < values.v_len(args) ? values.v_at(args, i) : values.v_const(0));
				}
				try {
					const result = f(self, ...given);
					entryError = "";
					return result;
				} catch (e) {
					if (!(e instanceof Fail) && !(e instanceof WebAssembly.RuntimeError)) throw e;
					entryError = e.message || "failed";
					return values.v_const(0);
				}
			},
			entry_error: () => entryError,
			throw(kind, message) {
				throw new Fail(1, kind, message);
			},
			regex_test: (pattern, text) => new RegExp(pattern).test(text),
			has_entry: (path) => entries.has(path),
			ask(name, args, request) {
				const handler = asks[name];
				if (typeof handler !== "function") return 0;
				let result;
				try {
					// With the arguments, the name each is made by, for the ones that are components.
					const names = [];
					for (let i = 0; i < values.v_len(args); i++) {
						names.push(rt.tw_name_of(values.v_at(args, i)));
					}
					result = handler(seeded.fromValue(args), { names });
				} catch (e) {
					askValue = seeded.toValue(String(e?.message ?? e));
					return 2;
				}
				if (!(result instanceof Promise)) {
					try {
						askValue = rt.tw_value(JSON.stringify(result ?? null));
					} catch (e) {
						askValue = seeded.toValue(String(e?.message ?? e));
						return 2;
					}
					return 1;
				}
				const later = result
					.then(
						(value) => rt.tw_answer(request, 1, JSON.stringify(value ?? null)),
						(e) => rt.tw_answer(request, 0, JSON.stringify(String(e?.message ?? e))),
					)
					.finally(() => waiting.delete(later));
				waiting.add(later);
				return 3;
			},
			ask_value: () => askValue,
			event_property: (name) => seeded.toValue(event?.[name] ?? null),
			event_prevent: () => event?.preventDefault?.(),
			event_stop: () => event?.stopPropagation?.(),
			text_of: (v) => String(seeded.fromValue(v)),
			now: () => env.now(),
			uuid: () => env.uuid(),
		},
		dom: domImports(document, rootNode, (v) => seeded.fromValue(v)),
	};
	const module = await WebAssembly.compile(await bytesOf(runtime), {
		builtins: ["js-string"],
		importedStringConstants: "_",
	});
	// The runtime's "values" imports are the functions of a compiled module that make and read
	// values, each under its own name.
	for (const { module: from, name } of WebAssembly.Module.imports(module)) {
		if (from === "values") imports.values[name] = (...args) => values[name](...args);
	}
	imports.values.v_class = (v) => values.v_class(v) ?? "";
	rt = (await WebAssembly.instantiate(module, imports)).exports;
	const must = (problem) => {
		if (problem !== "") throw new Error(problem);
	};
	// One listener for each type of event the views loaded bind, on the root's node.
	// What is being dragged and what it is over, as tutuca's DragTracker keeps them
	// (src/core/host/drag.js): the page marks the elements, the runtime knows the value.
	let dragged = null; // { node, type }
	let over = null;
	const mark = (node) => {
		if (node === over) return;
		if (over !== null) over.removeAttribute("data-draggingover");
		over = node;
		if (node !== null) node.setAttribute("data-draggingover", dragged?.type ?? "external");
	};
	const endDrag = () => {
		mark(null);
		if (dragged !== null) dragged.node.removeAttribute("data-dragging");
		dragged = null;
		rt.tw_drag_end();
	};
	const described = (e, found) =>
		JSON.stringify({
			type: e.type,
			key: e.key ?? null,
			held: HELD.filter((k) => e[k] === true),
			markers: found.markers,
			components: found.components,
			eids: found.eids,
		});
	const beforeEvent = (e) => {
		if (e.type === "dragstart") {
			const node = e.target.closest?.('[draggable="true"]');
			const found = node ? walkUp(node, rootNode) : null;
			if (found === null) return;
			endDrag();
			dragged = { node, type: node.getAttribute("data-dragtype") };
			rt.tw_drag_start(JSON.stringify(found.markers), dragged.type ?? "");
			node.setAttribute("data-dragging", "");
			if (e.dataTransfer) {
				e.dataTransfer.setData("text/plain", ""); // Firefox starts no drag without data.
				e.dataTransfer.effectAllowed = "move";
			}
		} else if (e.type === "drop") {
			e.preventDefault();
			mark(null);
		} else if (e.type === "dragleave") {
			if (!rootNode.contains(e.relatedTarget ?? null)) mark(null);
		} else if (DROP_EVENTS.has(e.type)) {
			const found = walkUp(e.target, rootNode);
			const at = found === null ? -1 : rt.tw_drop_target(described({ type: "drop" }, found));
			if (at >= 0) {
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = dragged === null ? "copy" : "move";
			}
			mark(at >= 0 ? found.nodes[at] : null);
		}
	};
	// One listener for each type of event the views loaded bind, on the root's node.
	const handleEvent = (e) => {
		beforeEvent(e);
		const found = walkUp(e.target, rootNode);
		if (found !== null) {
			event = e;
			try {
				rt.tw_event(described(e, found));
			} finally {
				event = null;
			}
		}
		if (e.type === "dragend") endDrag();
	};
	const listen = () => {
		if (rootNode === null) return;
		const types = JSON.parse(rt.tw_event_types());
		// What is dropped on needs the whole drag heard.
		for (const type of types.includes("drop") ? [...types, ...DRAG_EVENTS] : types) {
			if (listening.has(type)) continue;
			listening.add(type);
			rootNode.addEventListener(type, handleEvent);
		}
	};
	return {
		/**
		 * Checks a component module, compiles it and registers its components. Gives its
		 * diagnostics, and its model when there are none. register says the name each component
		 * is made by ({ Component: "Name" }), when it isn't what the module says.
		 */
		async load(
			source,
			{ resolve = null, hostModules = [], register = null, scope = [], check = false } = {},
		) {
			const front = componentModuleSource(source, { resolve, hostModules });
			if (!front.ok) return { ok: false, diagnostics: front.diagnostics, model: null };
			const analysis = purejs.analyze(
				withDirectives(front.source, {
					host: front.host,
					entries: front.entries,
					data: front.data,
				}),
			);
			// The names it registers its components under.
			const names = register ?? front.model.register ?? {};
			const types = front.model.components.map((c) => names[c.name] ?? c.name);
			if (!analysis.ok || !analysis.compiled.ok) {
				const diagnostics = [
					...analysis.diagnostics,
					...analysis.problems.map((p) => ({ code: "pure-tutuca::load", message: String(p) })),
					...(analysis.compiled?.problem
						? [{ code: "pure-tutuca::compile", ...analysis.compiled.problem }]
						: []),
				];
				return { ok: false, diagnostics, model: front.model };
			}
			const done = {
				ok: true,
				diagnostics: [],
				model: front.model,
				definitions: front.definitions,
				types,
				wat: analysis.compiled.wat,
			};
			if (check) return done;
			// The host modules' own functions take and give plain data; the runtime answers the rest
			// on the module's values.
			const host = Object.fromEntries(
				Object.entries(front.impls).map(([name, f]) => [name, (_self, ...args) => f(...args)]),
			);
			const rawHost = (name, self, args) =>
				rt.tw_owns(name, self) ? rt.tw_host(name, self, args) : undefined;
			const instance = new Instance(await compileBytes(analysis.compiled.bytes), { host, rawHost });
			// What the module's entries are found by: every module loaded has its own.
			const tag = `m${modules++}/`;
			must(
				rt.tw_define(
					JSON.stringify({
						scope,
						tag,
						asks: instance.entries
							.filter((name) => name.startsWith("askHandlers."))
							.map((name) => name.slice("askHandlers.".length)),
						definitions: front.definitions,
						interfaces: front.interfaces,
						metaSchemas: front.metaSchemas,
						// The name each component is made by: the page's word, or the module's, or its own.
						register: names,
					}),
				),
			);
			for (const name of instance.entries) entries.set(`${tag}${name}`, instance.exports[name]);
			instance.exports.init?.();
			// Each component's namespace, as the module made it: its views and its data.
			for (const name of Object.keys(front.definitions)) {
				const made = instance.exports[`const:${name}`];
				if (made !== undefined) rt.tw_component(`${tag}${name}`, made());
			}
			listen();
			return done;
		},
		/**
		 * Makes the root: a component of a type, from fields, in a scope (a path of names from the
		 * base; the base for none). In fields, { $make: Type, fields, scope } is a component to make.
		 */
		start(type, fields = {}, { scope = [] } = {}) {
			must(rt.tw_start(type, JSON.stringify(fields), JSON.stringify(scope)));
		},
		/**
		 * Whether a type makes from fields as they are, in a scope, changing nothing:
		 * { ok, error, issues: [{ field, problem }] }. A missing field with a default is fine.
		 */
		fits(type, fields = {}, { scope = [] } = {}) {
			const out = JSON.parse(rt.tw_fits(type, JSON.stringify(fields), JSON.stringify(scope)));
			return { ok: out.error === "" && out.issues.length === 0, ...out };
		},
		/**
		 * Why the component a path selects can't handle a message with these arguments now, running
		 * nothing: null when it can, "unknown", "args", "arg:N", "pre".
		 */
		messageProblem(name, args = [], { to = [] } = {}) {
			const problem = rt.tw_message_problem(name, JSON.stringify(args), JSON.stringify(to));
			return problem === "" ? null : problem;
		},
		/**
		 * What a path selects, as what makes it again: each component { $make: the name its scope
		 * makes it by, fields } with the fields that are kept (not the ones that sync at no level).
		 */
		capture(to = []) {
			const out = JSON.parse(rt.tw_capture(JSON.stringify(to)));
			if ("err" in out) throw new Error(out.err);
			return out.ok;
		},
		/** What a path selects, as it is now: an opaque value put() takes back. */
		hold(to = []) {
			return rt.tw_hold(JSON.stringify(to));
		},
		/** Puts a value hold() gave back where a path selects. */
		put(to, held) {
			rt.tw_put(JSON.stringify(to), held);
		},
		/** The name of the component a path selects; "" for what isn't one. */
		typeAt(to = []) {
			return rt.tw_type(JSON.stringify(to));
		},
		/** The names a scope makes components by; with walk, its parents' too. */
		names(scope = [], { walk = false } = {}) {
			return JSON.parse(rt.tw_names(JSON.stringify(scope), walk ? 1 : 0));
		},
		/** Forgets a scope and the ones below it: what was registered there can't be made any more. */
		leave(scope) {
			rt.tw_leave(JSON.stringify(scope));
		},
		/** Shows the root in the page: renders it now, and after every change. */
		mount() {
			if (document === null || rootNode === null)
				throw new Error("mount needs a document and a rootNode");
			must(rt.tw_mount());
		},
		/**
		 * Sends a message and runs what it starts: to the root, or to the component a path from it
		 * selects ("field", { item: "field", key }, { seqItem: "field", keyField }, or a list of those).
		 */
		send(name, args = [], { to = [] } = {}) {
			rt.tw_send(name, JSON.stringify(args), JSON.stringify(to));
		},
		/**
		 * What a component says of itself: a query's result, or a field's value, of the root or of
		 * the component a path from it selects.
		 */
		query(name, args = [], { to = [] } = {}) {
			const answer = JSON.parse(rt.tw_query(name, JSON.stringify(args), JSON.stringify(to)));
			if ("err" in answer) throw new Error(answer.err);
			return answer.ok;
		},
		/** Resolves once every ask the page took for later is answered, and what that started ran. */
		async idle() {
			while (waiting.size > 0) await Promise.all(waiting);
		},
		/** The root's state, as plain data. */
		state: () => JSON.parse(rt.tw_state()),
		/** What happened since the start: transitions and what they broke, and each settling. */
		reports: () => JSON.parse(rt.tw_reports()),
	};
}
