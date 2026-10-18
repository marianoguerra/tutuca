// The JS side of tutuca-mb's wasm-gc shell: the `tdom` imports the wasm/ package declares, the
// <tutuca-app> element, DevTools formatters, and instantiation with js-string builtins. A
// module exports `on_call(id, status, arg, text)` (re-exporting @wasm's), through which
// listeners, timeouts, file reads, margaui compiles and the console call back into it.

const isDescribed = (v) => v !== null && typeof v === "object" && v.__tutucaDescribed === true;

export function installFormatters(target = globalThis) {
	target.devtoolsFormatters ??= [];
	if (target.devtoolsFormatters.some((f) => f.tutuca)) return;
	target.devtoolsFormatters.push({
		tutuca: true,
		header: (v) => (isDescribed(v) ? ["span", {}, ...v.header()] : null),
		hasBody: (v) => isDescribed(v) && v.rows().length > 0,
		body: (v) => ["ol", { style: "list-style:none;margin:0;padding-left:14px" }, ...v.rows()],
	});
}

// <tutuca-app app-key="...">, as browser/app_element.mbt defines it for js.
export function defineAppElement(window, tagName = "tutuca-app") {
	if (window.customElements.get(tagName) !== undefined) return;
	class TutucaApp extends window.HTMLElement {
		static observedAttributes = ["app-key"];
		controller = null;
		mountedKey = null;
		current = null;
		get key() {
			return this.getAttribute("app-key");
		}
		connectedCallback() {
			if (this.current === null || this.mountedKey !== this.key) this.request();
		}
		disconnectedCallback() {
			queueMicrotask(() => {
				if (!this.isConnected) this.dispose();
			});
		}
		attributeChangedCallback() {
			if (this.isConnected) this.request();
		}
		request() {
			this.dispose();
			const doc = this.ownerDocument;
			const { CustomEvent } = doc.defaultView;
			const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
			const rootNode = doc.createElement("div");
			shadow.replaceChildren(rootNode);
			// Events from inside reach the page retargeted here: the outer host stops at it.
			this.setAttribute("data-tutuca-host", "app");
			const key = this.key;
			let controller = null;
			const detail = {
				key,
				element: this,
				rootNode,
				document: doc,
				adoptCss: (text) => {
					const style = doc.createElement("style");
					style.textContent = text;
					shadow.insertBefore(style, rootNode);
					return style;
				},
				adoptLink: (href) => {
					const link = doc.createElement("link");
					link.rel = "stylesheet";
					link.href = href;
					shadow.insertBefore(link, rootNode);
				},
				emit: (type, data) =>
					queueMicrotask(() => {
						if (this.current !== detail) return;
						const init = { bubbles: true, detail: { key, type, data } };
						this.dispatchEvent(new CustomEvent("tutucareport", init));
					}),
				mount: (c) => {
					controller = c;
				},
			};
			this.current = detail;
			this.mountedKey = key;
			this.dispatchEvent(new CustomEvent("tutucarequest", { bubbles: true, detail }));
			if (controller === null) rootNode.textContent = `no app for ${key}`;
			this.controller = controller;
		}
		dispose() {
			const { controller } = this;
			this.controller = null;
			this.current = null;
			this.mountedKey = null;
			controller?.dispose();
		}
	}
	window.customElements.define(tagName, TutucaApp);
}

export function createTdom(document = globalThis.document) {
	let exports = null;
	const call = (id, status = 0, arg = null, text = "") => exports.on_call(id, status, arg, text);
	// What a callback answers with tdom.ret, for the JS that called it.
	let slot;
	const take = () => {
		const v = slot;
		slot = undefined;
		return v;
	};
	const released =
		typeof FinalizationRegistry === "function" ? new FinalizationRegistry((id) => call(id, -1)) : null;
	const files = { next: 1, byId: new Map() };
	const window = () => document.defaultView ?? globalThis.window ?? globalThis;
	const setProp = (node, name, value) => {
		try {
			node[name] = value;
			return 1;
		} catch {
			return 0;
		}
	};
	const tdom = {
		is_null: (n) => (n === null || n === undefined ? 1 : 0),
		identity: (v) => v,
		document: () => document,
		null: () => null,
		query: (selector) => document.querySelector(selector),
		element_by_id: (id) => document.getElementById(id),
		create_element: (doc, tag, ns, is) => {
			const opts = is === "" ? undefined : { is };
			return ns === "" ? doc.createElement(tag, opts) : doc.createElementNS(ns, tag, opts);
		},
		create_text: (doc, s) => doc.createTextNode(s),
		create_comment: (doc, s) => doc.createComment(s),
		create_fragment: (doc) => doc.createDocumentFragment(),
		append_child: (p, c) => {
			p.appendChild(c);
		},
		insert_before: (p, n, r) => {
			p.insertBefore(n, r ?? null);
		},
		remove_child: (p, c) => {
			p.removeChild(c);
		},
		replace_child: (p, n, o) => {
			p.replaceChild(n, o);
		},
		replace_children: (n) => {
			n.replaceChildren();
		},
		parent_node: (n) => n.parentNode,
		first_child: (n) => n.firstChild,
		next_sibling: (n) => n.nextSibling,
		same: (a, b) => (a === b ? 1 : 0),
		set_attribute: (n, k, v) => {
			n.setAttribute(k, v);
		},
		remove_attribute: (n, k) => {
			n.removeAttribute(k);
		},
		has_attribute: (n, k) => (typeof n.hasAttribute === "function" && n.hasAttribute(k) ? 1 : 0),
		get_attribute: (n, k) => n.getAttribute(k) ?? "",
		has_property: (n, k) => (k in n ? 1 : 0),
		set_str_prop: setProp,
		set_num_prop: setProp,
		set_bool_prop: (n, k, v) => setProp(n, k, Boolean(v)),
		set_null_prop: (n, k) => setProp(n, k, null),
		get_inner_html: (n) => n.innerHTML,
		set_inner_html: (n, h) => {
			n.innerHTML = h;
		},
		set_text: (n, s) => {
			n.textContent = s;
		},
		set_data: (n, s) => {
			n.data = s;
		},
		get_data: (n) => (n.nodeType === 3 || n.nodeType === 8 ? n.data : ""),
		tag_name: (n) => n.tagName ?? "",
		namespace: (n) => n.namespaceURI ?? "",
		value: (n) => (n.value === undefined || n.value === null ? "" : String(n.value)),
		checked: (n) => (n.checked ? 1 : 0),
		// Events.
		listen: (node, name, id) => {
			node.addEventListener(name, (e) => call(id, 0, e));
		},
		event_target: (e) => e.target,
		event_type: (e) => e.type,
		event_key: (e) => e.key ?? "",
		event_detail: (e) => e.detail ?? null,
		event_num: (e, name) => (typeof e[name] === "number" ? e[name] : 0),
		event_flag: (e, name) => (e[name] ? 1 : 0),
		has_svg_point: (e) => {
			const t = e.target;
			if (!t || typeof e.clientX !== "number") return 0;
			const svg = t.tagName?.toLowerCase() === "svg" ? t : (t.ownerSVGElement ?? t.closest?.("svg"));
			if (!svg) return 0;
			const ctm = svg.getScreenCTM?.();
			let x;
			let y;
			if (ctm && typeof DOMPoint === "function") {
				const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
				x = p.x;
				y = p.y;
			} else {
				const box = svg.getBoundingClientRect();
				x = e.clientX - box.left;
				y = e.clientY - box.top;
			}
			e.__tutucaPoint = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
			return 1;
		},
		svg_x: (e) => e.__tutucaPoint[0],
		svg_y: (e) => e.__tutucaPoint[1],
		prevent_default: (e) => {
			e.preventDefault();
		},
		capture_pointer: (e) => {
			try {
				e.target?.closest?.("svg")?.setPointerCapture?.(e.pointerId);
			} catch {}
		},
		// Files: a picked file is kept by id until read.
		file_count: (e) => e.target?.files?.length ?? 0,
		keep_file: (e, i) => {
			const id = files.next++;
			files.byId.set(id, e.target.files[i]);
			return id;
		},
		file_name: (id) => files.byId.get(id)?.name ?? "",
		read_file: (fileId, id) => {
			const file = files.byId.get(fileId);
			if (file === undefined) {
				call(id, 1, null, `no file ${fileId}`);
				return;
			}
			file.text().then(
				(text) => call(id, 0, null, text),
				(e) => call(id, 1, null, String(e?.message ?? e)),
			);
		},
		download: (filename, text, type) => {
			const URL = window().URL ?? globalThis.URL;
			if (document?.createElement === undefined || URL?.createObjectURL === undefined) return;
			const url = URL.createObjectURL(new (window().Blob ?? Blob)([text], { type }));
			Object.assign(document.createElement("a"), { href: url, download: filename }).click();
			setTimeout(() => URL.revokeObjectURL(url), 0);
		},
		// Time.
		set_timeout: (id, ms) => {
			setTimeout(() => call(id), ms);
		},
		now: () => Date.now(),
		local_offset: (now) => -new Date(now).getTimezoneOffset(),
		iso_today: () => {
			const d = new Date();
			const p = (n) => String(n).padStart(2, "0");
			return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
		},
		log_error: (s) => console.error(s),
		console_log: (v) => console.log(v),
		// margaui ("margaui" in the page's import map).
		margaui: (classes, id) => {
			import("margaui")
				.then((m) => m.compile(classes.split(" ").filter((c) => c !== "")))
				.then(
					(css) => call(id, 0, null, css),
					(error) => console.error("margaui compile failed", error),
				);
		},
		scroll_top: (root) => {
			for (const node of [root.querySelector("[data-story-main]"), document.scrollingElement]) {
				if (node) node.scrollTop = 0;
			}
		},
		// <tutuca-app>.
		define_app_element: (tag) => defineAppElement(window(), tag),
		req_key: (d) => d.key ?? "",
		req_element: (d) => d.element,
		req_root: (d) => d.rootNode,
		req_adopt_css: (d, css) => d.adoptCss(css),
		req_adopt_link: (d, href) => d.adoptLink(href),
		req_emit: (d, type, json) => d.emit(type, JSON.parse(json)),
		req_mount: (d, id) => d.mount({ dispose: () => call(id) }),
		// DevTools formatters: JsonML parts, and described values answered through `ret`.
		ret: (v) => {
			slot = v;
		},
		ml_array: () => [],
		ml_push: (a, v) => {
			a.push(v);
		},
		ml_span: (style, parts) => ["span", { style }, ...parts],
		ml_li: (label, hasLabel, part) =>
			hasLabel ? ["li", {}, ["span", { style: "color:#8b5cf6" }, label], ": ", part] : ["li", {}, part],
		ml_ref: (v) => ["object", { object: v }],
		described: (id) => {
			const v = {
				__tutucaDescribed: true,
				header: () => (call(id, 0), take()),
				rows: () => (call(id, 1), take()),
			};
			released?.register(v, id);
			return v;
		},
		install_formatters: () => installFormatters(),
		expose: (name, id) => {
			const get = (status) => () => (call(id, status), take());
			globalThis.tutuca ??= {};
			globalThis.tutuca[name] = Object.defineProperties(
				{ componentAt: (node) => (call(id, 3, node), take()) },
				{
					state: { get: get(0), enumerable: true },
					vdom: { get: get(1), enumerable: true },
					component: { get: get(2), enumerable: true },
				},
			);
		},
	};
	return { tdom, bind: (instanceExports) => (exports = instanceExports) };
}

// Instantiates a wasm-gc tutuca module from its bytes, binding the tdom callbacks to it.
export async function instantiate(bytes, { document = globalThis.document, extra = {} } = {}) {
	const { tdom, bind } = createTdom(document);
	const imports = { tdom, ...extra };
	const opts = { builtins: ["js-string"], importedStringConstants: "_" };
	const { instance } = await WebAssembly.instantiate(bytes, imports, opts);
	bind(instance.exports);
	return instance;
}

// Fetches and instantiates the module at `url` (a page's way in).
export async function load(url, options) {
	const bytes = await (await fetch(url)).arrayBuffer();
	return instantiate(bytes, options);
}
