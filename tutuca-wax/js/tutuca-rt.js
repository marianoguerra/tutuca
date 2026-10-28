// The JS side of tutuca-wax: what the wasm module imports (the DOM, the
// world, the host's observers and asks), loading the module and component
// modules (README.md has their convention), building values,
// vnodes and semantic trees from JS values, and driving a host: running its
// tasks, routing DOM events to it, settling the asks JS answers.
//
// Strings cross the boundary as JS strings. Engines with the js-string
// builtins and imported string constants (V8 from Chrome 131 and Node 24,
// Firefox 134) supply the "wasm:js-string" and "'" imports themselves; for
// the others, the same imports are polyfilled here, which is slower but
// behaves the same.

// fromCharCodeArray reads a wasm-gc array, which JS can only do through the
// instance's u16_array_get export: exports is the instance's, set once it's
// made.
const jsStringPolyfill = (instance) => ({
	equals: (a, b) => (a === b ? 1 : 0),
	length: (s) => s.length,
	charCodeAt: (s, i) => s.charCodeAt(i),
	concat: (a, b) => a + b,
	fromCharCodeArray: (units, start, end) => {
		const get = instance.exports.u16_array_get;
		let out = "";
		for (let i = start; i < end; i++) out += String.fromCharCode(get(units, i));
		return out;
	},
});

// One module instance's DOM imports. owned is the WeakSet of nodes render
// made: morphing matches vnodes only to these. late.fromValue turns a list,
// map or result into the JS value it stands for, so the DOM gets what tutuca's
// JS gives it (an array prop is the array, an array attribute "1,2"); it's
// set once the instance exists.
function domImports(late) {
	const owned = new WeakSet();
	const setProperty = (node, name, value) => {
		try {
			node[name] = value;
			return 1;
		} catch {
			return 0;
		}
	};
	return {
		create_element: (doc, tag, ns, is) => {
			const opts = is == null ? undefined : { is };
			return ns == null ? doc.createElement(tag, opts) : doc.createElementNS(ns, tag, opts);
		},
		create_text: (doc, text) => doc.createTextNode(text),
		create_comment: (doc, text) => doc.createComment(text),
		create_fragment: (doc) => doc.createDocumentFragment(),
		append_child: (parent, child) => {
			parent.appendChild(child);
		},
		insert_before: (parent, node, ref) => {
			parent.insertBefore(node, ref);
		},
		remove_child: (parent, child) => {
			parent.removeChild(child);
		},
		replace_child: (parent, node, old) => {
			parent.replaceChild(node, old);
		},
		replace_children: (node) => node.replaceChildren(),
		parent_node: (node) => node.parentNode,
		first_child: (node) => node.firstChild,
		next_sibling: (node) => node.nextSibling,
		is_same_node: (a, b) => (a === b ? 1 : 0),
		set_attribute_string: (node, name, value) => node.setAttribute(name, value),
		set_attribute_number: (node, name, value) => node.setAttribute(name, value),
		set_attribute_bool: (node, name, value) => node.setAttribute(name, value !== 0),
		set_attribute_ref: (node, name, value) => node.setAttribute(name, late.fromValue(value)),
		remove_attribute: (node, name) => node.removeAttribute(name),
		has_property: (node, name) => (name in node ? 1 : 0),
		set_string_property: setProperty,
		set_number_property: setProperty,
		set_bool_property: (node, name, value) => setProperty(node, name, value !== 0),
		set_ref_property: (node, name, value) => setProperty(node, name, late.fromValue(value)),
		get_inner_html: (node) => node.innerHTML,
		set_inner_html: (node, html) => {
			node.innerHTML = html;
		},
		set_data: (node, text) => {
			node.data = text;
		},
		tag_name: (node) => node.tagName,
		namespace_uri: (node) => node.namespaceURI,
		own: (node) => {
			owned.add(node);
		},
		is_owned: (node) => (owned.has(node) ? 1 : 0),
		previous_sibling: (node) => node.previousSibling,
		comment_data: (node) => (node.nodeType === 8 ? node.data : null),
		// The attribute, not dataset: not every element has one (MathML in jsdom).
		get_eid: (node) => {
			const eid = node.getAttribute?.("data-eid") ?? null;
			return eid === null ? -1 : Number.parseInt(eid, 10);
		},
		// The element with the handler: checked for a checkbox, value otherwise.
		target_value: (node) => late.toValue(node.type === "checkbox" ? node.checked : node.value),
		// Drag and drop.
		closest_draggable: (node) => node.closest?.('[draggable="true"]') ?? null,
		dataset_get: (node, name) => node.dataset?.[name] ?? null,
		dataset_set: (node, name, value) => {
			node.dataset[name] = value;
		},
		dataset_delete: (node, name) => {
			delete node.dataset[name];
		},
		contains: (container, node) => (node != null && container.contains(node) ? 1 : 0),
		prevent_default: (e) => e.preventDefault(),
		stop_propagation: (e) => e.stopPropagation(),
		related_target: (e) => e.relatedTarget ?? null,
		drag_start: (e) => {
			if (!e.dataTransfer) return;
			e.dataTransfer.setData("text/plain", ""); // Firefox starts no drag without data.
			e.dataTransfer.effectAllowed = "move";
		},
		drop_effect_move: (e) => {
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		},
		fail: (message) => {
			throw new Error(message);
		},
	};
}

// Compiles a module, the runtime or a component, with the engine's js-string
// builtins and string constants unless builtins is false. imports are the
// module's imports; strings is the "'" import object for the string
// constants the engine didn't take, each the string its name spells.
async function compileModule(bytes, builtins) {
	const options = builtins ? { builtins: ["js-string"], importedStringConstants: "'" } : {};
	const module = await WebAssembly.compile(bytes, options);
	// Whatever the engine didn't take as a builtin is still listed as an import.
	const imports = WebAssembly.Module.imports(module);
	const strings = {};
	for (const { module: from, name } of imports) {
		if (from === "'") strings[name] = name;
	}
	return { module, imports, strings };
}

// The bytes at a URL: read from disk in Node for a file: URL, fetched otherwise.
export async function readBytes(url) {
	if (typeof process !== "undefined" && process.versions?.node && url.protocol === "file:") {
		const { readFile } = await import("node:fs/promises");
		return readFile(url);
	}
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
	return response.arrayBuffer();
}

// A pattern constraint's regular expression, compiled once.
const regexes = new Map();
const regexOf = (pattern) => {
	if (!regexes.has(pattern)) regexes.set(pattern, new RegExp(pattern));
	return regexes.get(pattern);
};

// The fields of a DOM event handlers read as ctx.event (and a view's
// event(name) send argument): its type, the key and the modifier keys held,
// the pointer's buttons, position, movement and kind, a wheel's deltas, and
// a CustomEvent's detail when it's a string, number or boolean; only the ones
// the event has.
const EVENT_FIELDS = [
	"key",
	"code",
	"repeat",
	"altKey",
	"ctrlKey",
	"shiftKey",
	"metaKey",
	"button",
	"buttons",
	"clientX",
	"clientY",
	"offsetX",
	"offsetY",
	"pageX",
	"pageY",
	"screenX",
	"screenY",
	"movementX",
	"movementY",
	"pointerId",
	"pointerType",
	"isPrimary",
	"pressure",
	"width",
	"height",
	"tiltX",
	"tiltY",
	"deltaX",
	"deltaY",
	"deltaZ",
	"deltaMode",
	"detail",
];
export const eventFields = (e) => {
	const out = { type: e.type };
	for (const name of EVENT_FIELDS) {
		const v = e[name];
		if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[name] = v;
	}
	return out;
};

// What a component module may import: the runtime's ABI, the js-string
// builtins and its string constants.
const COMPONENT_IMPORTS = new Set(["tutuca", "wasm:js-string", "'"]);

// Compiles and instantiates the module from its bytes. builtins: false skips
// the engine's js-string builtins and string constants for the polyfills, to
// test the path engines without them take; component modules loaded through
// it take the same path.
export async function instantiate(bytes, { builtins = true } = {}) {
	const { module, imports, strings } = await compileModule(bytes, builtins);
	const late = { exports: null, fromValue: null, toValue: null, host: null };
	const instance = await WebAssembly.instantiate(module, {
		"wasm:js-string": jsStringPolyfill(late),
		"'": strings,
		dom: domImports(late),
		// The world, as the current host's env gives it.
		env: {
			now: () => late.host?.env.now() ?? Date.now(),
			random: () => late.host?.env.random() ?? Math.random(),
			uuid: () => late.host?.env.uuid() ?? crypto.randomUUID(),
		},
		host: {
			observe_log: (v) => late.host?.report("log", { value: late.fromValue(v) }),
			observe_unhandled: (name) => late.host?.report("unhandled", { message: name }),
			ask: (name, args) => late.host.ask(name, late.fromValue(args)),
			number_text: (n) => String(n),
			parse_number: (s) => (s.trim() === "" ? Number.NaN : Number(s)),
			regex_test: (pattern, s) => (regexOf(pattern).test(s) ? 1 : 0),
			reject: (message, info) => {
				const error = new Error(message);
				error.rejection = late.fromValue(info);
				throw error;
			},
			observe_issue: (type, info) => late.host?.report(type, late.fromValue(info)),
		},
	});
	late.exports = instance.exports;
	const api = makeApi(instance.exports);
	late.fromValue = api.values.to;
	late.toValue = api.values.from;
	api.runtime = makeRuntime(instance.exports, api, late);
	// Whether the engine supplied the js-string builtins and string constants.
	api.builtins = !imports.some((i) => i.module === "wasm:js-string" || i.module === "'");
	// Loads a component module (README.md has the convention) and registers
	// its component types in scope. source is its bytes or a URL. It imports
	// the runtime's ABI from this instance, which the engine checks against
	// the types it declares when it links them. Resolves with what the module
	// is: its size, imports and exports, and the constant class names the
	// views of the types it registered use (classes), to compile CSS for.
	// names maps the names the module registers its types as to the names to
	// register them as here, null skipping one; the others keep theirs.
	api.loadComponent = async (source, scope, { names = {} } = {}) => {
		const bytes = source instanceof URL ? await readBytes(source) : source;
		const component = await compileModule(bytes, builtins);
		const foreign = [...new Set(component.imports.map((i) => i.module).filter((m) => !COMPONENT_IMPORTS.has(m)))];
		if (foreign.length > 0) {
			throw new Error(`A component module imports only from tutuca, wasm:js-string and ', not from ${foreign.join(", ")}`);
		}
		const tutuca = {};
		for (const { module: from, name } of component.imports) {
			if (from !== "tutuca") continue;
			if (typeof instance.exports[name] !== "function") throw new Error(`The runtime has no ${name} for the component module to import`);
			tutuca[name] = instance.exports[name];
		}
		// The specs it registers, as it registers them, and under which names.
		const specs = [];
		const registered = [];
		// Set while a dry run into a throwaway scope lists the names.
		let listing = null;
		if (tutuca.scope_register) {
			tutuca.scope_register = (s, as, spec, vtable) => {
				if (listing) return void listing.push(as);
				const name = Object.hasOwn(names, as) ? names[as] : as;
				registered.push({ as, name });
				if (name === null) return;
				specs.push(spec);
				instance.exports.scope_register(s, name, spec, vtable);
			};
		}
		const { exports } = await WebAssembly.instantiate(component.module, {
			tutuca,
			"'": component.strings,
			"wasm:js-string": jsStringPolyfill(late),
		});
		const version = typeof exports.tutuca_abi_version === "function" ? exports.tutuca_abi_version() : undefined;
		const expected = instance.exports.tutuca_abi_version();
		if (version !== expected) {
			throw new Error(`The component module is for ABI version ${version ?? "(none)"}, the runtime's is ${expected}`);
		}
		if (typeof exports.tutuca_register !== "function") throw new Error("The component module doesn't export tutuca_register");
		// Checked before registering anything: a name it doesn't register is a mistake.
		if (Object.keys(names).length > 0) {
			listing = [];
			exports.tutuca_register(instance.exports.scope_root());
			const unknown = Object.keys(names).filter((as) => !listing.includes(as));
			listing = null;
			if (unknown.length > 0) throw new Error(`The component module registers no ${unknown.join(", ")} to rename`);
		}
		exports.tutuca_register(scope);
		const classes = new Set(specs.flatMap((spec) => api.values.to(instance.exports.spec_classes(spec))));
		return {
			size: bytes.byteLength,
			classes: [...classes],
			imports: component.imports.map(({ module: from, name }) => ({ module: from, name })),
			exports: Object.keys(exports),
			registered,
		};
	};
	return api;
}

// Loads dist/tutuca-rt.wasm from a URL (in a browser) or a path (in Node).
export async function load(url = new URL("../dist/tutuca-rt.wasm", import.meta.url), options = {}) {
	return instantiate(await readBytes(url), options);
}

// Building vnodes from JS values, the way tutuca's test helpers do.
function makeApi(w) {
	const strArray = (strings) => {
		const out = w.str_array_new(strings.length);
		strings.forEach((s, i) => w.str_array_set(out, i, s));
		return out;
	};
	const valueArray = (values) => {
		const out = w.value_array_new(values.length);
		values.forEach((v, i) => w.value_array_set(out, i, toValue(v)));
		return out;
	};
	// Wasm-gc objects reach JS as objects with a null prototype.
	const isWasm = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === null;
	const INT_MIN = -(2 ** 31);
	const INT_MAX = 2 ** 31 - 1;
	// A JS value as a Value: null and undefined are Null, an integer in i32's
	// range an Int and any other number a Float, an array a List, a plain
	// object a Map (so { __html } is dangerouslySetInnerHTML's markup, as in
	// JS). A Value made here passes through, results (ok, err) and components
	// included.
	const toValue = (v) => {
		if (v == null) return w.value_null();
		switch (typeof v) {
			case "string":
				return w.value_string(v);
			case "number":
				return Number.isInteger(v) && v >= INT_MIN && v <= INT_MAX && !Object.is(v, -0)
					? w.value_int(v)
					: w.value_float(v);
			case "boolean":
				return w.value_bool(v ? 1 : 0);
			case "object": {
				if (isWasm(v)) return v;
				if (Array.isArray(v)) return v.reduce((list, item) => w.list_push(list, toValue(item)), w.list_empty());
				const proto = Object.getPrototypeOf(v);
				if (proto === Object.prototype) {
					let map = w.map_empty();
					for (const [key, item] of Object.entries(v)) map = w.map_assoc(map, key, toValue(item));
					return map;
				}
			}
		}
		throw new TypeError(`no Value for ${String(v)}`);
	};
	const KIND = ["null", "bool", "int", "float", "string", "list", "map", "result", "component"];
	// A Value as a JS value, the inverse of toValue: a result is { ok: value }
	// or { err: value }, and a component stays the opaque object it is.
	const fromValue = (v) => {
		switch (KIND[w.value_kind(v)]) {
			case "null":
				return null;
			case "bool":
				return w.value_bool_get(v) !== 0;
			case "int":
				return w.value_int_get(v);
			case "float":
				return w.value_float_get(v);
			case "string":
				return w.value_string_get(v);
			case "list":
				return Array.from({ length: w.list_count(v) }, (_, i) => fromValue(w.list_get(v, i)));
			case "map": {
				const keys = w.map_keys(v);
				const out = {};
				for (let i = 0; i < w.list_count(keys); i++) {
					const key = w.value_string_get(w.list_get(keys, i));
					// defineProperty, so a "__proto__" key is a key.
					Object.defineProperty(out, key, { value: fromValue(w.map_get(v, key)), enumerable: true, writable: true, configurable: true });
				}
				return out;
			}
			case "result":
				return w.value_result_ok(v) ? { ok: fromValue(w.value_result_value(v)) } : { err: fromValue(w.value_result_value(v)) };
			default:
				return v;
		}
	};
	const values = {
		from: toValue,
		to: fromValue,
		kind: (v) => KIND[w.value_kind(v)],
		ok: (v) => w.value_ok(toValue(v)),
		err: (v) => w.value_err(toValue(v)),
		// JS ===, as a render compares props.
		same: (a, b) => w.value_same(toValue(a), toValue(b)) !== 0,
		truthy: (v) => w.value_truthy(toValue(v)) !== 0,
	};
	// Wasm GC structs are opaque JS objects: they can key a WeakSet.
	const isVNode = (v) => v !== null && typeof v === "object" && vnodes.has(v);
	// The vnodes made here, so a child can be told from an iterable of children.
	const vnodes = new WeakSet();
	const made = (v) => {
		vnodes.add(v);
		return v;
	};
	const text = (s) => made(w.vnode_text(String(s)));
	const comment = (s) => made(w.vnode_comment(String(s)));
	const addChild = (childs, child) => {
		if (child == null) return;
		if (isVNode(child)) childs.push(child);
		else if (typeof child !== "string" && typeof child[Symbol.iterator] === "function") {
			for (const c of child) addChild(childs, c);
		} else childs.push(text(child));
	};
	const vnodeArray = (children) => {
		const childs = [];
		addChild(childs, children);
		const out = w.vnode_array_new(childs.length);
		childs.forEach((c, i) => w.vnode_array_set(out, i, c));
		return out;
	};
	// new Shape(tag, namespace, staticAttrs, names)
	const shape = (tag, namespace = null, staticAttrs = {}, names = []) => {
		const staticNames = Object.keys(staticAttrs);
		return w.shape_new(
			tag,
			namespace,
			strArray(staticNames),
			valueArray(staticNames.map((n) => staticAttrs[n])),
			strArray(names),
		);
	};
	// Every attr dynamic, and shapes cached by tag, namespace and attr names,
	// so equal templates share a shape, as tutuca's test helper vh does.
	const shapes = new Map();
	const shapeFor = (tag, namespace, names) => {
		const id = JSON.stringify([tag, namespace, names]);
		if (!shapes.has(id)) shapes.set(id, shape(tag, namespace, {}, names));
		return shapes.get(id);
	};
	const h = (tag, attrs = {}, children = null) => {
		const { key, namespace = null, ...rest } = attrs;
		const names = Object.keys(rest);
		const values = names.map((name) => rest[name]);
		return elem(shapeFor(tag, namespace, names), values, children, key);
	};
	const elem = (shape, values, children = null, key = null) =>
		made(w.vnode_elem(shape, valueArray(values), vnodeArray(children), key == null ? null : String(key)));
	const frag = (children, key = null) => made(w.vnode_frag(vnodeArray(children), key == null ? null : String(key)));
	const optKey = (key) => (key == null ? null : String(key));
	const arrayOf = (make, set, items, convert) => {
		const out = make(items.length);
		items.forEach((item, i) => set(out, i, convert(item)));
		return out;
	};

	// The semantic tree (src/sem.wax), in the spec's terms. A path key is a
	// string (a name) or an integer (an index).
	const pathKey = (key) => (typeof key === "number" ? w.path_key_index(key) : w.path_key_name(key));
	const pathKeys = (keys) => arrayOf(w.path_key_array_new, w.path_key_array_set, keys, pathKey);
	const frame = ({ keys = [], item = null, provider = null, isComponent = false } = {}) =>
		w.frame_new(
			pathKeys(keys),
			item == null ? null : pathKey(item),
			provider == null ? null : w.provider_new(provider.name, provider.depth, pathKeys(provider.keys)),
			isComponent ? 1 : 0,
		);
	// A send argument: a literal, { targetValue: true }, { sourceKey: true },
	// { dragKey: true }, { event: name }, or { if: [test, then, otherwise] }.
	const arg = (a) => {
		if (a !== null && typeof a === "object") {
			if (a.targetValue) return w.arg_target_value();
			if (a.sourceKey) return w.arg_source_key();
			if (a.dragKey) return w.arg_drag_key();
			if (typeof a.event === "string") return w.arg_event(a.event);
			if (Array.isArray(a.if)) return w.arg_if(arg(a.if[0]), arg(a.if[1]), arg(a.if[2]));
		}
		return w.arg_value(toValue(a));
	};
	// A template: tid, tag, and { namespace, staticAttrs, names, handlers },
	// handlers being [{ event, name, args }].
	const template = (tid, tag, { namespace = null, staticAttrs = {}, names = [], handlers = [] } = {}) => {
		const staticNames = Object.keys(staticAttrs);
		const ons = arrayOf(w.on_attr_array_new, w.on_attr_array_set, handlers, (h) =>
			w.on_attr_new(h.event, h.name, arrayOf(w.arg_array_new, w.arg_array_set, h.args ?? [], arg)),
		);
		return w.template_new(
			tid,
			tag,
			namespace,
			strArray(staticNames),
			valueArray(staticNames.map((n) => staticAttrs[n])),
			strArray(names),
			ons,
		);
	};
	const snodes = new WeakSet();
	const snode = (n) => {
		snodes.add(n);
		return n;
	};
	const addSChild = (childs, child) => {
		if (child == null) return;
		if (child !== null && typeof child === "object" && snodes.has(child)) childs.push(child);
		else if (typeof child !== "string" && typeof child[Symbol.iterator] === "function") {
			for (const c of child) addSChild(childs, c);
		} else childs.push(snode(w.snode_text(String(child))));
	};
	const snodeArray = (children) => {
		const childs = [];
		addSChild(childs, children);
		return arrayOf(w.snode_array_new, w.snode_array_set, childs, (c) => c);
	};
	const sem = {
		frame,
		template,
		// The text of a frame's opening metadata comment.
		frameMeta: (f) => w.frame_meta_text(f),
		el: (tmpl, values = [], children = null, key = null) =>
			snode(w.snode_el(tmpl, valueArray(values), optKey(key), snodeArray(children))),
		text: (s) => snode(w.snode_text(String(s))),
		comment: (s) => snode(w.snode_comment(String(s))),
		group: (children, key = null) => snode(w.snode_group(optKey(key), snodeArray(children))),
		component: (name, children) => snode(w.snode_component(name, snodeArray(children))),
		enter: (f, children) => snode(w.snode_enter(f, snodeArray(children))),
		// A loop: entries are [{ key, frame, body }].
		items: (entries) =>
			snode(
				w.snode_items(
					arrayOf(w.entry_array_new, w.entry_array_set, entries, (e) =>
						w.entry_new(optKey(e.key), e.frame, snodeArray(e.body)),
					),
				),
			),
		// The vnodes a semantic tree lowers to.
		lower: (children) => w.lower(snodeArray(children)),
		// Lowers children and renders them, morphing from prev (what the last
		// render returned). Returns what to pass as prev next time.
		render(document, container, children, prev = null) {
			const childs = w.lower(snodeArray(children));
			w.render(document, container, childs, prev);
			return childs;
		},
	};
	// Views as data (src/view.wax), spelled as tutuca's view builders spell
	// them: anything that isn't a view is a constant.
	const viewNodes = new WeakSet();
	const viewNode = (v) => {
		viewNodes.add(v);
		return v;
	};
	const toView = (v) => (v !== null && typeof v === "object" && viewNodes.has(v) ? v : viewNode(w.view_const(toValue(v))));
	const viewArray = (items) => arrayOf(w.view_array_new, w.view_array_set, items.flat(Infinity), toView);
	// Send arguments, as sem's arg describes them; a view is none.
	const sendArgs = new WeakSet();
	const sendArg = (a) => {
		sendArgs.add(a);
		return a;
	};
	const isSendArg = (a) => a !== null && typeof a === "object" && sendArgs.has(a);
	const toSendArg = (a) => {
		if (a !== null && typeof a === "object" && viewNodes.has(a)) {
			throw new Error("A send argument must be a constant, targetValue, sourceKey, dragKey, event or an if of them");
		}
		return arg(a);
	};
	const view = {
		// The kinds' names, by view_kind_* number.
		KINDS: [
			"const",
			"field",
			"seqItem",
			"provided",
			"lookupBind",
			"if",
			"el",
			"frag",
			"render",
			"each",
			"renderEach",
			"renderIt",
			"scope",
			"pushView",
		],
		constant: (v) => viewNode(w.view_const(toValue(v))),
		field: (name) => viewNode(w.view_field(name)),
		seqItem: (seqName, keyName) => viewNode(w.view_seq_item(seqName, keyName)),
		provided: (name) => viewNode(w.view_provided(name)),
		lookupBind: (name) => viewNode(w.view_lookup_bind(name)),
		// An if of send arguments, when a branch is one, is a send argument too.
		if: (test, then, otherwise) =>
			[test, then, otherwise].some(isSendArg)
				? sendArg({ if: [test, then, otherwise] })
				: viewNode(w.view_if(toView(test), toView(then), toView(otherwise))),
		// h(tag, { key, namespace, "on:event": send(...), ...attrs }, ...childs)
		h: (tag, attrs = {}, ...childs) => {
			const { key = null, namespace = null, ...rest } = attrs;
			const names = Object.keys(rest).filter((n) => !n.startsWith("on:"));
			const ons = Object.keys(rest)
				.filter((n) => n.startsWith("on:"))
				.map((n) => w.view_on(n.slice(3), rest[n]));
			return viewNode(
				w.view_el(
					tag,
					namespace,
					strArray(names),
					viewArray(names.map((n) => rest[n])),
					key == null ? null : toView(key),
					viewArray(childs),
					arrayOf(w.view_on_array_new, w.view_on_array_set, ons, (o) => o),
				),
			);
		},
		frag: (...childs) => viewNode(w.view_frag(viewArray(childs))),
		render: (source, viewName = null) => viewNode(w.view_render(source, viewName)),
		each: (source, body, loopName = null) => viewNode(w.view_each(source, toView(body), loopName)),
		renderEach: (source, loopName = null) => viewNode(w.view_render_each(source, loopName)),
		renderIt: (viewName = null) => viewNode(w.view_render_it(viewName)),
		scope: (name, body) => viewNode(w.view_scope(name, toView(body))),
		pushView: (viewName, body) => viewNode(w.view_push_view(toView(viewName), toView(body))),
		// An action, for an "on:event" attr; not a view child. Its arguments
		// are the handler table's (sem's arg), not views.
		send: (name, ...args) => w.view_action(name, arrayOf(w.arg_array_new, w.arg_array_set, args, toSendArg)),
		targetValue: () => sendArg({ targetValue: true }),
		sourceKey: () => sendArg({ sourceKey: true }),
		dragKey: () => sendArg({ dragKey: true }),
		// A field of the event (key, clientX, ctrlKey, ...), as a send argument.
		event: (name) => sendArg({ event: name }),
		// The templates of views (src/collect.wax), setting each element's.
		templates(views) {
			const ts = w.views_collect_templates(viewArray(views));
			return Array.from({ length: w.template_array_length(ts) }, (_, i) => w.template_array_get(ts, i));
		},
		tid: (template) => w.template_tid(template),
		// The template collecting set on an element, or null.
		templateOf: (el) => w.view_el_template(el),
		// The constant class names of views, each once.
		classes: (views) => values.to(w.views_collect_classes(viewArray(views))),
		// The kinds a walker visits, in order, by name: overriding node and
		// element, or only each and render.
		kinds: (views) => values.to(w.views_walk_kinds(viewArray(views))).map((k) => view.KINDS[k]),
		loops: (views) => values.to(w.views_walk_loops(viewArray(views))).map((k) => view.KINDS[k]),
	};
	return {
		values,
		sem,
		view,
		exports: w,
		text,
		comment,
		h,
		elem,
		frag,
		shape,
		// The flat array of vnodes value normalizes to, to render and to pass
		// as prev next time.
		childs: vnodeArray,
		length: (childs) => w.vnode_array_length(childs),
		// Renders childs into container, morphing from prev (what the last
		// render rendered) when given. Returns what to pass as prev next time.
		render(document, container, children, prev = null) {
			const childs = vnodeArray(children);
			w.render(document, container, childs, prev);
			return childs;
		},
	};
}

// The component runtime, from JS: scopes, components, and hosts.
function makeRuntime(w, api, late) {
	const { values } = api;
	// A component by type name, made in scope from fields (a JS object):
	// throws with init's error when it can't be made.
	const make = (scope, name, fields = {}) => {
		const made = w.scope_make(scope, name, values.from(fields));
		const result = values.to(made);
		if ("err" in result) throw new Error(String(result.err));
		return w.value_result_value(made);
	};
	// A host for root, rendering into container, in document; a headless
	// one, with both null, only runs tasks. env gives now, random and uuid;
	// asks answers the asks registered with registerHostAsk, by name, with a
	// value or a promise of one (an error is replied as its message, since a
	// value can't hold a JS object); dev checks the state against the schemas of
	// its components and messages against their contracts. What happens goes
	// to host.reports as { type, ...info }, with tutuca's Host.notify types,
	// and to onReport(type, info) as it happens. One module instance drives
	// one host.
	const errorText = (error) => String(error?.message ?? error);
	const ISSUES = new Set(["stateInvalid", "messageInvalid"]);
	const createHost = (document, container, root, { env = {}, asks = {}, dev = false, onReport = null } = {}) => {
		const h = w.host_new(document, container, root);
		const inflight = new Set();
		let nextAsk = 0; // The id of the next ask answered later.
		const listener = (e) => host.dispatch(e);
		let running = false;
		let stopped = false; // Unmounted: it renders and listens no more.
		let tick = null; // The timeout of the next run, when tasks are left.
		const listening = [];
		const schedule = () => {
			tick ??= setTimeout(() => {
				tick = null;
				host.run();
			}, 0);
		};
		const reportsOf = (pick) => host.reports.filter((r) => pick(r.type));
		const host = {
			// What happened, in order: log { value }, unhandled { message },
			// taskFailed { error }, renderFailed { error }, render, and in dev
			// mode stateInvalid and messageInvalid { message, component, ... }.
			reports: [],
			report(type, info = {}) {
				const r = { type, ...info };
				host.reports.push(r);
				onReport?.(type, r);
			},
			// Views of reports, by type.
			get logs() {
				return reportsOf((t) => t === "log").map((r) => r.value);
			},
			get unhandled() {
				return reportsOf((t) => t === "unhandled").map((r) => r.message);
			},
			get failures() {
				return reportsOf((t) => t === "taskFailed" || t === "renderFailed").map((r) => r.error);
			},
			get issues() {
				return reportsOf((t) => ISSUES.has(t));
			},
			headless: container === null,
			env: {
				now: env.now ?? (() => Date.now()),
				random: env.random ?? (() => Math.random()),
				uuid: env.uuid ?? (() => crypto.randomUUID()),
			},
			// The root component, as a value.
			root: () => w.host_root(h),
			// Runs the queued tasks, one transaction each, for up to 16ms, then
			// renders and listens to the events the registered types handle;
			// the tasks left run on the next tick, after the browser had a
			// turn. A task that fails (throws or traps) is dropped with nothing
			// committed. Called while a run is on (an event the render caused),
			// it leaves the tasks to that run.
			run() {
				if (running || stopped) return;
				running = true;
				late.host = host;
				clearTimeout(tick);
				tick = null;
				const start = Date.now();
				try {
					while (w.host_has_tasks(h)) {
						try {
							w.host_step(h);
						} catch (error) {
							host.report("taskFailed", { error });
							w.host_after_failure(h);
						}
						if (Date.now() - start > 16) break;
					}
					try {
						if (w.host_render(h)) host.report("render");
					} catch (error) {
						host.report("renderFailed", { error });
					}
					host.listen();
				} finally {
					running = false;
					if (w.host_has_tasks(h)) schedule();
				}
			},
			// Listens on the container for the events the types in the root's
			// scope tree handle, the ones loaded since included.
			listen() {
				if (host.headless) return;
				for (const type of values.to(w.host_new_event_names(h))) {
					container.addEventListener(type, listener);
					listening.push(type);
				}
			},
			// Stops: no more listening, runs or renders, and the container
			// emptied, so another host can mount there.
			unmount() {
				stopped = true;
				clearTimeout(tick);
				tick = null;
				for (const type of listening.splice(0)) container?.removeEventListener(type, listener);
				container?.replaceChildren();
			},
			// A message to the root, from outside it.
			send(name, args = []) {
				late.host = host;
				w.host_send(h, name, values.from(args));
				host.run();
			},
			// Routes a DOM event to the handler it reaches, if any, and runs.
			dispatch(e) {
				late.host = host;
				const event = values.from(eventFields(e));
				if (w.host_dispatch_event(h, e, e.target, e.type, event)) host.run();
			},
			// Renders, and listens to the events its components handle.
			mount() {
				host.run();
				return host;
			},
			// Resolves once the asks in flight are answered and the tasks left
			// for later have run.
			async settled() {
				while (inflight.size > 0 || tick !== null) {
					if (inflight.size > 0) await Promise.allSettled([...inflight]);
					else await new Promise((resolve) => setTimeout(resolve, 0));
				}
			},
			// The ask import: answers through asks[name], as tutuca's JS does:
			// a value replies now, a promise later (with the id host_settle
			// gets back), a throw or a rejection with _reply_error, and a name
			// asks lacks with _handler_not_found.
			ask(name, args) {
				if (!Object.hasOwn(asks, name)) return values.from(null);
				let answer;
				try {
					answer = asks[name](...args);
				} catch (error) {
					return w.value_err(values.from(errorText(error)));
				}
				if (typeof answer?.then !== "function") return w.value_ok(values.from(answer));
				const id = nextAsk++;
				const done = Promise.resolve(answer)
					.then(
						(v) => w.value_ok(values.from(v)),
						(error) => w.value_err(values.from(errorText(error))),
					)
					.then((result) => {
						late.host = host;
						w.host_settle(h, id, result);
						host.run();
					});
				inflight.add(done);
				done.finally(() => inflight.delete(done));
				return values.from(id);
			},
		};
		if (dev) {
			late.host = host;
			w.host_set_dev(h, 1);
		}
		return host;
	};
	return {
		scope: () => w.scope_root(),
		enter: (scope, name) => w.scope_enter(scope, name),
		// Drops the child named so: what was made in it goes on working, and
		// entering the name again makes a new one.
		leave: (scope, name) => w.scope_leave(scope, name),
		registerHostAsk: (scope, name) => w.scope_register_host_ask(scope, name),
		make,
		// init's issues making a component: [{ field, problem }].
		issues: (scope, name, fields = {}) => values.to(w.scope_make_issues(scope, name, values.from(fields))),
		typeName: (component) => w.component_type_name(component),
		// The name component's type is made by from scope, which a rename at
		// loadComponent may make other than its typeName; null when none is.
		nameIn: (scope, component) => values.to(w.scope_name_of(scope, component)),
		// A component's type's schema: { name, fields, gets, messages,
		// invariants, interfaces }, types written as TCD writes them; null
		// for a type without one.
		schema: (component) => values.to(w.component_schema(component)),
		// Why component can't take the message name with args now (they don't
		// fit its schema, or its guard doesn't hold), or null when it can.
		messageProblem: (component, name, args = []) => values.to(w.component_message_problem(component, name, values.from(args))),
		// The interface registered as name, visible from scope, or null.
		interface: (scope, name) => values.to(w.scope_interface(scope, name)),
		// A component's property, as a JS value.
		get: (component, name) => values.to(w.component_get(component, name)),
		createHost,
	};
}
