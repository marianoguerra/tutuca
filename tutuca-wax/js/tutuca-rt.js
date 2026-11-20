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
// made: morphing matches vnodes only to these. late.fromValue turns a list
// or map into the JS value it stands for, so the DOM gets what tutuca's
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
		drop_effect: (e, move) => {
			if (e.dataTransfer) e.dataTransfer.dropEffect = move ? "move" : "copy";
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

// The text of a module's custom section named name, or null when it has
// none (or isn't a wasm module). Read from the bytes (a buffer or a view),
// without compiling them.
export function customSection(source, name) {
	const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
	let at = 8;
	const leb = () => {
		let n = 0;
		for (let shift = 0; ; shift += 7) {
			const b = bytes[at++];
			n += (b & 0x7f) * 2 ** shift;
			if ((b & 0x80) === 0) return n;
		}
	};
	if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) return null;
	while (at < bytes.length) {
		const id = bytes[at++];
		const size = leb();
		const end = at + size;
		if (id === 0) {
			const length = leb();
			if (new TextDecoder().decode(bytes.subarray(at, at + length)) === name) return new TextDecoder().decode(bytes.subarray(at + length, end));
		}
		at = end;
	}
	return null;
}

// The module's bytes with a custom section named name holding text (UTF-8)
// at the end, as pure-tutuca/api/meta.mbt's with_custom_section writes one.
export function withCustomSection(source, name, text) {
	const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
	const leb = (n) => {
		const out = [];
		do {
			let b = n & 0x7f;
			n = Math.floor(n / 128);
			if (n !== 0) b |= 0x80;
			out.push(b);
		} while (n !== 0);
		return out;
	};
	const nameBytes = new TextEncoder().encode(name);
	const payload = new TextEncoder().encode(text);
	const content = [...leb(nameBytes.length), ...nameBytes];
	const size = content.length + payload.length;
	const head = [0, ...leb(size)];
	const out = new Uint8Array(bytes.length + head.length + size);
	out.set(bytes, 0);
	out.set(head, bytes.length);
	out.set(content, bytes.length + head.length);
	out.set(payload, bytes.length + head.length + content.length);
	return out;
}

// The well-known meta URIs (components/meta/meta.tutuca.ts, tutuca's src/display.js
// and the canvas's): how to show a component to people, and what it says to
// a canvas holding it.
export const DISPLAY_META = "https://tutuca.dev/meta/display";
export const CANVAS_META = "https://tutuca.dev/meta/canvas";
// What a component's views can compute as classes: { classes: "a b" }, which
// loadComponent's classes include.
export const CLASSES_META = "https://tutuca.dev/meta/classes";
// A display meta's icon and title, as a label ("📝 Notes"), or null when it
// has no title: tutuca's displayLabel.
export function displayLabel(display) {
	const title = display?.title;
	if (typeof title !== "string" || title === "") return null;
	const icon = display.icon;
	return typeof icon === "string" && icon !== "" ? `${icon} ${title}` : title;
}

// What a component module pure-tutuca built says about itself: the JSON of its
// "tutuca" custom section (pure-tutuca/api/meta.mbt: its sources, the types it
// registers, the interfaces it declares, what it needs from a scope, its
// host asks, and its components' meta: registered name -> URI -> record), or
// null when it has none.
export function componentMeta(source) {
	const text = customSection(source, "tutuca");
	return text === null ? null : JSON.parse(text);
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

// The answers to an ask, by answer_* number (prelude/component.wax): a
// message reported for one is named as the ask, with which answer it is.
const ANSWERS = [null, "ok", "error", "unhandled"];
const messageInfo = (name, answer) => (answer === 0 ? { message: name } : { message: name, answer: ANSWERS[answer] });

// What a component module may import: the runtime's ABI, the js-string
// builtins and its string constants.
const COMPONENT_IMPORTS = new Set(["tutuca", "wasm:js-string", "'"]);

// Compiles and instantiates the module from its bytes. builtins: false skips
// the engine's js-string builtins and string constants for the polyfills, to
// test the path engines without them take; component modules loaded through
// it take the same path.
export async function instantiate(bytes, { builtins = true } = {}) {
	const { module, imports, strings } = await compileModule(bytes, builtins);
	const late = { exports: null, fromValue: null, toValue: null, host: null, fns: new Map() };
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
			observe_unhandled: (name, answer) => late.host?.report("unhandled", messageInfo(name, answer)),
			observe_stale: (name, answer) => late.host?.report("stale", messageInfo(name, answer)),
			observe_orphaned: (name, answer) => late.host?.report("orphaned", messageInfo(name, answer)),
			abort_ask: (id) => late.host?.abortAsk(id),
			ask: (name, args) => late.host.ask(name, late.fromValue(args)),
			call: (name, args) => {
				const fn = late.fns.get(name);
				if (!fn) return late.toValue({ err: `no host function ${name}` });
				try {
					return late.toValue({ ok: fn(...late.fromValue(args)) });
				} catch (error) {
					return late.toValue({ err: String(error?.message ?? error) });
				}
			},
			value_json: (v, indent) => JSON.stringify(late.fromValue(v), null, indent || undefined) ?? "null",
			str_slice: (s, start, end) => s.slice(start, end),
			str_index_of: (s, needle, from) => s.indexOf(needle, from),
			str_lower: (s) => s.toLowerCase(),
			str_upper: (s) => s.toUpperCase(),
			str_trim: (s) => s.trim(),
			str_replace_all: (s, from, to) => s.replaceAll(from, to),
			str_split: (s, sep) => late.toValue(s.split(sep)),
			str_join: (parts, sep) => late.fromValue(parts).map(String).join(sep),
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
	// The page's functions components call now, by name (host_call): fn
	// gets the arguments as JS values and returns one, which the component
	// gets as { ok: it }; what it throws, as { err: its message }.
	api.runtime.defineHostFn = (name, fn) => {
		late.fns.set(name, fn);
	};
	api.runtime.hostFns = () => [...late.fns.keys()];
	// JSON text as a value (an object a map, an array a list), for
	// components that edit JSON as text.
	api.runtime.defineHostFn("json_parse", (text) => JSON.parse(text));
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
	// A JS value as a Value: null is Null and undefined Undefined, a number a Number
	// (any: -0, NaN and the infinities as they are), an array a List, a
	// plain object a Map (so { __html } is dangerouslySetInnerHTML's markup,
	// as in JS, and an outcome is { ok: value } or { err: error }). A Value
	// made here passes through, components included.
	const toValue = (v) => {
		if (v === null) return w.value_null();
		if (v === undefined) return w.value_undefined();
		switch (typeof v) {
			case "string":
				return w.value_string(v);
			case "number":
				return w.value_number(v);
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
	// The kinds' names, by value_kind_* number.
	const KIND = ["null", "bool", "number", "string", "list", "map", "component", "undefined"];
	// A Value as a JS value, the inverse of toValue: a component stays the
	// opaque object it is.
	const fromValue = (v) => {
		switch (KIND[w.value_kind(v)]) {
			case "null":
				return null;
			case "undefined":
				return undefined;
			case "bool":
				return w.value_bool_get(v) !== 0;
			case "number":
				return w.value_number_get(v);
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
			default:
				return v;
		}
	};
	const values = {
		from: toValue,
		to: fromValue,
		kind: (v) => KIND[w.value_kind(v)],
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
	// { dragKey: true }, { event: name }, { field: name } (the receiver's),
	// { field: name, of: seq } (the item at the source key of the receiver's
	// seq), or { if: [test, then, otherwise] }.
	const arg = (a) => {
		if (a !== null && typeof a === "object") {
			if (a.targetValue) return w.arg_target_value();
			if (a.sourceKey) return w.arg_source_key();
			if (a.dragKey) return w.arg_drag_key();
			if (typeof a.event === "string") return w.arg_event(a.event);
			if (typeof a.field === "string") return typeof a.of === "string" ? w.arg_item_field(a.of, a.field) : w.arg_field(a.field);
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
		// provides, { name: keys }, is where each value the component provides is in it.
		component: (name, children, provides = null) => {
			if (provides === null) return snode(w.snode_component(name, snodeArray(children)));
			const names = Object.keys(provides);
			const out = w.str_array_new(names.length);
			names.forEach((n, i) => w.str_array_set(out, i, n));
			const keys = arrayOf(w.path_key_array_array_new, w.path_key_array_array_set, names, (n) => pathKeys(provides[n]));
			return snode(w.snode_component_providing(name, out, keys, snodeArray(children)));
		},
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
			"eq",
			"query",
		],
		constant: (v) => viewNode(w.view_const(toValue(v))),
		field: (name) => viewNode(w.view_field(name)),
		seqItem: (seqName, keyName) => viewNode(w.view_seq_item(seqName, keyName)),
		provided: (name) => viewNode(w.view_provided(name)),
		lookupBind: (name) => viewNode(w.view_lookup_bind(name)),
		// left == value, or != with negate: a bool, as conditions compare.
		eq: (left, value, negate = false) => viewNode(w.view_eq(toView(left), toValue(value), negate ? 1 : 0)),
		// $query(name, ...args): the rendered component's query name.
		query: (name, ...args) => viewNode(w.view_query(name, viewArray(args))),
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
	// run's outcome (a query's, an apply's) as JS, or, when what it ran threw (a
	// host call that failed, a trap), { err } with code failed and the error's
	// message, as a handler that rejects gives.
	const guarded = (component, name, run) => {
		let out;
		try {
			out = run();
		} catch (error) {
			return values.to(w.component_failure(component, name, String(error?.message ?? error)));
		}
		return values.to(out);
	};
	// A component by type name, made in scope from fields (a JS object):
	// throws with init's error when it can't be made.
	const make = (scope, name, fields = {}) => {
		const result = values.to(w.scope_make(scope, name, values.from(fields)));
		if ("err" in result) throw new Error(String(result.err));
		return result.ok;
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
	// A selector from the root for to: a list of steps, each a field
	// ("child") or an item of a list or map field (["items", 0]).
	const selectorKey = (k) => (typeof k === "number" ? w.path_key_index(k) : w.path_key_name(k));
	const selectorStep = (s) => (Array.isArray(s) ? w.selector_item(s[0], selectorKey(s[1])) : w.selector_field(s));
	const selectorOf = (to) => to.map(selectorStep).reduce((a, b) => w.selector_join(a, b), w.selector_root());
	const ISSUES = new Set(["stateInvalid", "messageInvalid"]);
	// renderCache: whether a render reuses what the last one rendered for a
	// component where nothing it depends on changed (tutuca's CopyCache, the
	// default); false renders everything every time (NullCache).
	const createHost = (document, container, root, { env = {}, asks = {}, dev = false, onReport = null, publish = null, renderCache = true } = {}) => {
		const h = w.host_new(document, container, root);
		if (!renderCache) w.host_set_render_cache(h, 0);
		// What host.listen hears (tutuca's Transition and HostEvent records),
		// numbered as reported; the dev issues found since the last record
		// that took them, for the record of what caused them.
		const listeners = new Set();
		let reported = 0;
		let lastSeq = null; // The number of the last task run, for upTo.
		let taskIssues = [];
		let settledIssues = [];
		let settledRoot = null; // The root last reported settled.
		const watchTimers = new Map(); // A watch's id -> its timeout's timer.
		const controllers = new Map(); // An ask answered later's id -> its AbortController.
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
			// taskFailed { error }, renderFailed { error }, eventFailed
			// { error } (an event the DOM couldn't route), stale { message }
			// (one for a component another took the place of), orphaned
			// { message } (one for a place no component is at), render, and in dev
			// mode stateInvalid and messageInvalid { message, component, ... }.
			// A message that is an ask's answer is named as the ask and says
			// which answer it is: { message: "fetch", answer: "error" }.
			// Each but render and eventFailed says where it came from: path,
			// the keys from the root to the component the task was for
			// (["items", 2]).
			reports: [],
			report(type, info = {}) {
				const untasked = type === "render" || type === "eventFailed";
				const r = untasked ? { type, ...info } : { type, ...info, path: values.to(w.host_task_path(h)) };
				host.reports.push(r);
				onReport?.(type, r);
				if (type === "stateInvalid") {
					const into = r.settled ? settledIssues : taskIssues;
					for (const i of r.issues) into.push({ check: "state", ...i, reason: i.problem ?? i.reason, path: r.path });
				} else if (type === "messageInvalid") taskIssues.push({ check: "message", ...r });
			},
			// fn(record) hears what the host reports, each after what caused it,
			// in order (tutuca's host.listen): a Transition ({ kind:
			// "transition", seq, cause, origin, mode, name, args, from, to,
			// outcome, error, emitted, unhandled, watch, issues }, and for
			// an answer, mode answer, its ask's name and answer) for what
			// became of each task, outcome one of handled, passed, unhandled,
			// failed, stale, orphaned and asked; a HostEvent ({ kind:
			// "hostEvent", type, issues, ... }) for the rest: started,
			// stopped, rendered { upTo }, renderFailed { error, upTo },
			// eventFailed { eventType, error } and settled { upTo }. Each has
			// n, its number, and at, env.now() when reported. Returns a
			// function that stops it.
			listen(fn) {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
			// Numbers record and stamps it, then tells the listeners after the
			// current task, or createHost's publish at once. Unheard, it isn't
			// stamped: the clock isn't read for nobody.
			announce(record) {
				record.n = ++reported;
				if (publish === null && listeners.size === 0) return;
				record.at = host.env.now();
				if (publish !== null) return publish(record);
				setTimeout(() => {
					for (const fn of listeners) fn(record);
				}, 0);
			},
			// A HostEvent of type: fields plain, issues what dev checks found.
			hostEvent(type, fields = {}, issues = []) {
				host.announce({ kind: "hostEvent", type, ...fields, issues });
			},
			// The records the runtime made besides the tasks' transitions:
			// dropped tasks', and watches opening (whose timeout is armed
			// here, tutuca's startWatchTimer) and settling (cleared).
			takeEvents() {
				for (const r of values.to(w.host_take_events(h))) {
					if (r.kind === "transition") {
						host.announce({ ...r, error: null, issues: [] });
						continue;
					}
					const { kind: _, type, ...fields } = r;
					if (type === "watchOpened" && fields.timeout !== null) {
						const timer = setTimeout(() => {
							watchTimers.delete(fields.watch);
							late.host = host;
							if (w.host_cancel_watch(h, fields.watch, 1)) {
								host.takeEvents();
								host.run();
							}
						}, fields.timeout);
						watchTimers.set(fields.watch, timer);
					}
					if (type === "watchSettled") {
						clearTimeout(watchTimers.get(fields.watch));
						watchTimers.delete(fields.watch);
					}
					host.hostEvent(type, fields);
				}
			},
			abortAsk(id) {
				controllers.get(id)?.abort();
				controllers.delete(id);
			},
			// Views of reports, by type.
			get logs() {
				return reportsOf((t) => t === "log").map((r) => r.value);
			},
			get unhandled() {
				return reportsOf((t) => t === "unhandled").map((r) => r.message);
			},
			get failures() {
				return reportsOf((t) => t === "taskFailed" || t === "renderFailed" || t === "eventFailed").map(
					(r) => r.error,
				);
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
			// How many components its renders reused from the render cache,
			// and rendered: { hits, misses }.
			cacheStats: () => values.to(w.host_cache_stats(h)),
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
						let error = null;
						try {
							w.host_step(h);
						} catch (e) {
							error = e;
							host.report("taskFailed", { error });
							w.host_after_failure(h);
						}
						const record = values.to(w.host_transition(h));
						if (error !== null) {
							record.outcome = "failed";
							record.emitted = [];
							record.unhandled = [];
						}
						const issues = taskIssues;
						taskIssues = [];
						lastSeq = record.seq;
						host.announce({ ...record, error, issues });
						host.takeEvents();
						if (Date.now() - start > 16) break;
					}
					try {
						if (w.host_render(h)) {
							host.report("render");
							host.hostEvent("rendered", { upTo: lastSeq });
						}
					} catch (error) {
						host.report("renderFailed", { error });
						host.hostEvent("renderFailed", { error, upTo: lastSeq });
					}
					host.listenToEvents();
				} finally {
					running = false;
					if (w.host_has_tasks(h)) schedule();
					else host.reportSettled();
				}
			},
			// The root settled: nothing is left to run. Reported, with the
			// invariants it breaks, once per root that settles.
			reportSettled() {
				const now = w.host_root(h);
				if (now === settledRoot) return;
				settledRoot = now;
				const issues = settledIssues;
				settledIssues = [];
				host.hostEvent("settled", { upTo: lastSeq }, issues);
			},
			// Listens on the container for the events the types registered
			// so far handle, in any scope, the ones loaded since included.
			listenToEvents() {
				if (host.headless) return;
				for (const type of values.to(w.host_new_event_names(h))) {
					container.addEventListener(type, listener);
					listening.push(type);
				}
			},
			// Stops: no more listening, runs or renders, and the container
			// emptied, so another host can mount there.
			unmount() {
				if (stopped) return;
				stopped = true;
				clearTimeout(tick);
				tick = null;
				// Nothing more runs: what's queued and the answers on their way.
				w.host_clear(h);
				for (const timer of watchTimers.values()) clearTimeout(timer);
				watchTimers.clear();
				for (const c of controllers.values()) c.abort();
				controllers.clear();
				host.hostEvent("stopped");
				for (const type of listening.splice(0)) container?.removeEventListener(type, listener);
				container?.replaceChildren();
			},
			// Sends name(...args) from the host (tutuca's host.send) to the
			// component to reaches from the root, the root by default: to is a
			// list of steps, each a field ("child") or an item of a list or map
			// field (["items", 0], ["byId", "a"]). One sent now has run when
			// send returns: it goes ahead of the queue, behind a bubble under
			// way. Any other waits at the back of the queue for the next tick
			// (await host.settled()). Returns its number.
			send(name, args = [], { to = [], now = false } = {}) {
				const sel = selectorOf(to);
				late.host = host;
				const seq = w.host_send(h, name, values.from(args), sel, now ? 1 : 0);
				if (now) host.run();
				else if (!running) schedule();
				return seq;
			},
			// Applies the pure message name(...args) to the component to
			// reaches (as send takes it) at once, as a change from outside
			// (tutuca's host.apply): no task, no queue, rendered when it
			// returns. Throws a ContractError-shaped error ({ code, issues,
			// detail, component, message }) when the component there doesn't
			// support it or breaks its contract, its invariants included, and
			// then nothing changes. Reported as a transition of mode apply.
			// Returns the component it is now.
			apply(name, args = [], { to = [] } = {}) {
				late.host = host;
				const result = w.host_apply(h, name, values.from(args), selectorOf(to));
				host.takeEvents();
				const out = values.to(result);
				if ("err" in out) {
					const e = out.err;
					const text = `${e.component ?? "not a component"}.${e.message}: ${e.issues.join(", ")}${e.detail ? ` (${e.detail})` : ""}`;
					throw Object.assign(new Error(text), { name: "ContractError", ...e });
				}
				host.run();
				return out.ok;
			},
			// What component to reaches, now, runs its query name(...args)
			// with: what runtime.query gives.
			query(name, args = [], { to = [] } = {}) {
				const component = w.host_value_at(h, selectorOf(to));
				return guarded(component, name, () => w.component_query(component, name, values.from(args)));
			},
			// Where to reaches from the root, now: { path, id } (tutuca's
			// addressOf).
			addressOf(to = []) {
				return values.to(w.host_address_of(h, selectorOf(to)));
			},
			// Routes a DOM event to the handler it reaches, if any, and runs it
			// now. One the DOM can't route (it doesn't match the root, after a
			// render failed), or whose arguments fail, is reported, instead of
			// escaping the listener.
			dispatch(e) {
				late.host = host;
				let queued;
				try {
					queued = w.host_dispatch_event(h, e, e.target, e.type, values.from(eventFields(e)));
				} catch (error) {
					host.report("eventFailed", { error });
					host.hostEvent("eventFailed", { eventType: e.type, error });
					return;
				}
				if (queued) host.run();
			},
			// Renders, and listens to the events its components handle.
			mount() {
				const issues = taskIssues;
				taskIssues = [];
				host.hostEvent("started", {}, issues);
				host.run();
				return host;
			},
			// Resolves once the asks in flight are answered and the tasks left
			// for later have run.
			async settled() {
				while (!stopped && (inflight.size > 0 || tick !== null)) {
					if (inflight.size > 0) await Promise.allSettled([...inflight]);
					else await new Promise((resolve) => setTimeout(resolve, 0));
				}
			},
			// The ask import: answers through asks[name], as tutuca's JS does:
			// a value replies now (the ok answer, as { ok: value }), a promise
			// later (with the id host_settle gets back), a throw or a
			// rejection with the error answer ({ err: its message }), and a
			// name asks lacks with the unhandled answer.
			// The handler reads this.signal, aborted when the watch the ask is in
			// is cancelled (tutuca's read ctx signal).
			ask(name, args) {
				if (!Object.hasOwn(asks, name)) return values.from(null);
				const controller = new AbortController();
				let answer;
				try {
					answer = asks[name].call({ signal: controller.signal }, ...args);
				} catch (error) {
					return values.from({ err: errorText(error) });
				}
				if (typeof answer?.then !== "function") return values.from({ ok: answer });
				const id = nextAsk++;
				controllers.set(id, controller);
				const done = Promise.resolve(answer)
					.then(
						(v) => values.from({ ok: v }),
						(error) => values.from({ err: errorText(error) }),
					)
					.then((result) => {
						controllers.delete(id);
						if (stopped || controller.signal.aborted) return; // Nothing waits for it.
						late.host = host;
						w.host_settle(h, id, result);
						host.takeEvents();
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
		// invariants, interfaces }, types as a module writes them (TodoItem[], number | null, ...); null
		// for a type without one.
		schema: (component) => values.to(w.component_schema(component)),
		// Why component can't take the message name with args now (they don't
		// fit its schema, or its guard doesn't hold), or null when it can.
		messageProblem: (component, name, args = []) => values.to(w.component_message_problem(component, name, values.from(args))),
		// Runs component's query name with args (tutuca's query): { ok: value },
		// or { err: { code, issues, detail, component, message } } as apply
		// gives, code one of unknown, args, arg:<i>, failed, returns.
		// What it runs may throw (a host call that fails): that's failed too.
		query: (component, name, args = []) => guarded(component, name, () => w.component_query(component, name, values.from(args))),
		// Applies component's pure message name with args outside any task
		// (tutuca's apply): { ok: the component after it } (the same one
		// when nothing changed), its invariants checked, or { err: { code,
		// issues, detail, component, message } }, code one of unknown,
		// not-pure, args, arg:<i>, pre (detail: its why), failed, post,
		// invariant:<name>.
		apply: (component, name, args = []) => guarded(component, name, () => w.component_apply_js(component, name, values.from(args))),
		// What component offers (tutuca's contractOf): { name, implements:
		// [{ name, resolved, interface }], messages: [{ name, pure, args }],
		// queries: [{ name, args, returns }], notifies }, or null for a type
		// without a schema.
		contractOf: (component) => values.to(w.component_contract(component)),
		// The same for the type registered as name, visible from scope, its
		// interfaces resolved there; null when none is.
		typeContractOf: (scope, name) => values.to(w.scope_contract(scope, name)),
		// What component lacks to implement the interface registered as name
		// in its scope (tutuca's interfaceGaps): every problem, empty when it
		// implements it.
		supports: (component, name) => values.to(w.component_supports(component, name)),
		// Whether component has the pure message name, or the query name.
		canApply: (component, name) => values.to(w.component_contract(component))?.messages.some((m) => m.name === name && m.pure) ?? false,
		canQuery: (component, name) => values.to(w.component_contract(component))?.queries.some((q) => q.name === name) ?? false,
		// The interface registered as name, visible from scope, or null.
		interface: (scope, name) => values.to(w.scope_interface(scope, name)),
		// A copy of component (or a value holding components) in which every
		// component is a new one, with a fresh identity at any depth, as
		// tutuca's copy: what to put in the tree a second time.
		copy: (component) => w.value_copy(component),
		// A component's identity (tutuca's idOf): fresh when it's made, kept
		// by its updates; null for what isn't one.
		idOf: (component) => w.component_id(component) || null,
		// A component's property, as a JS value.
		get: (component, name) => values.to(w.component_get(component, name)),
		// What a component says about itself under uri (a meta URI such as
		// DISPLAY_META), over the defaults of the schema its scope has for
		// it: tutuca's metaOf. {} for nothing said and no schema.
		metaOf: (component, uri) => values.to(w.component_meta_of(component, uri)),
		// The same for the type registered as name, visible from scope; null
		// when none is.
		typeMetaOf: (scope, name, uri) => values.to(w.scope_meta_of(scope, name, uri)),
		// What component renders for the render target named target (tutuca's
		// renders, renderedVNodes): its views for target (view, or main),
		// as plain data for target's renderer: a list of elements { tag,
		// attrs, key?, children }, each tag the target's node type (md's
		// Paragraph), and texts. A component without views for target fails,
		// unless fallsBackToViews, when it renders its page views.
		renderTarget: (component, target, { view = null, fallsBackToViews = false } = {}) =>
			values.to(w.render_target(component, target, view, fallsBackToViews ? 1 : 0)),
		// Whether component says anything under uri (tutuca's hasMeta).
		hasMeta: (component, uri) => w.component_has_meta(component, uri) === 1,
		// What's wrong with what component says under uri, against the
		// schema its scope has for it (tutuca's metaShapeProblems): a list,
		// empty when it says nothing there or there's no schema. metaOf is
		// what it says over the schema's defaults (tutuca's filledMeta).
		metaProblems: (component, uri) => values.to(w.component_meta_problems(component, uri)),
		// The meta schema registered for uri, visible from scope: { uri,
		// fields, defaults }, or null.
		metaSchema: (scope, uri) => values.to(w.scope_meta_schema(scope, uri)),
		createHost,
	};
}
