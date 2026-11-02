// css-layout-lab: a CSS Grid or Flexbox container (a "css-container" part, data {display, css})
// and its items ("css-item" parts, data {label, css}), where css is a string of declarations.
// The workspace previews the layout live, shows the CSS it makes and warns about properties
// outside a small grid/flex/box allowlist. The root's handlers are the tools; the controls and
// the item rows go through the same handlers.
export default function define(kit) {
	const { apply, component, each, field, render, send, sourceKey, t, tag, targetValue } =
		kit.tutuca;
	const { message } = kit.tdata;
	const { encodeParts, kidsOf, nextId, strOf, withData, withPart } = kit.lib.parts;
	const { labHeader, listHandlers, listOf, messageList, section } = kit.ui;
	const { div, input, label, option, select, span, textarea } = tag;
	const DISPLAYS = ["grid", "flex", "inline-grid", "inline-flex", "block"];
	const SIDES = (p) => [
		p,
		`${p}-top`,
		`${p}-right`,
		`${p}-bottom`,
		`${p}-left`,
		`${p}-inline`,
		`${p}-block`,
	];
	const PROPERTIES = new Set([
		"display",
		"flex-direction",
		"flex-wrap",
		"flex-flow",
		"flex",
		"flex-grow",
		"flex-shrink",
		"flex-basis",
		"order",
		"justify-content",
		"justify-items",
		"justify-self",
		"align-content",
		"align-items",
		"align-self",
		"place-content",
		"place-items",
		"place-self",
		"gap",
		"row-gap",
		"column-gap",
		"grid",
		"grid-template",
		"grid-template-columns",
		"grid-template-rows",
		"grid-template-areas",
		"grid-auto-flow",
		"grid-auto-columns",
		"grid-auto-rows",
		"grid-area",
		"grid-column",
		"grid-column-start",
		"grid-column-end",
		"grid-row",
		"grid-row-start",
		"grid-row-end",
		"width",
		"height",
		"min-width",
		"min-height",
		"max-width",
		"max-height",
		"aspect-ratio",
		"box-sizing",
		"overflow",
		"overflow-x",
		"overflow-y",
		"position",
		"inset",
		"top",
		"right",
		"bottom",
		"left",
		"z-index",
		"background",
		"background-color",
		"color",
		"border",
		"border-radius",
		"border-color",
		"border-width",
		"border-style",
		"opacity",
		"font-size",
		"font-weight",
		"line-height",
		"text-align",
		"white-space",
		"visibility",
		...SIDES("margin"),
		...SIDES("padding"),
	]);
	// The quick controls: selects first, then free text inputs.
	const SELECTS = [
		{ property: "display", values: DISPLAYS },
		{ property: "flex-direction", values: ["", "row", "row-reverse", "column", "column-reverse"] },
		{
			property: "justify-content",
			values: ["", "start", "center", "end", "space-between", "space-around", "space-evenly"],
		},
		{ property: "align-items", values: ["", "stretch", "start", "center", "end", "baseline"] },
	];
	const INPUTS = ["gap", "grid-template-columns"];

	// Declarations: "a: b; c: d" split at semicolons outside quotes and parentheses.
	const splitTop = (text, sep) => {
		const out = [];
		let depth = 0;
		let quote = "";
		let cur = "";
		for (const c of text) {
			if (quote) quote = c === quote ? "" : quote;
			else if (c === '"' || c === "'") quote = c;
			else if (c === "(") depth++;
			else if (c === ")") depth--;
			else if (depth === 0 && (sep === " " ? /\s/.test(c) : c === sep)) {
				out.push(cur);
				cur = "";
				continue;
			}
			cur += c;
		}
		return [...out, cur].map((s) => s.trim()).filter((s) => s !== "");
	};
	const parseDecls = (css) =>
		splitTop(css.replace(/\/\*[\s\S]*?\*\//g, ""), ";").map((chunk) => {
			const at = chunk.indexOf(":");
			return at < 0
				? { property: "", value: "", text: chunk }
				: {
						property: chunk.slice(0, at).trim().toLowerCase(),
						value: chunk.slice(at + 1).trim(),
						text: chunk,
					};
		});
	const formatDecls = (decls) => decls.map((d) => `${d.property}: ${d.value};`).join("\n");
	// css with property set to value (or removed when value is ""), the first one kept in place.
	const withProperty = (css, property, value) => {
		const decls = parseDecls(css).filter((d) => d.property !== "");
		const i = decls.findIndex((d) => d.property === property);
		const rest = decls.filter((d, j) => d.property !== property || j === i);
		if (value === "") return formatDecls(rest.filter((d) => d.property !== property));
		if (i < 0) return formatDecls([...rest, { property, value }]);
		return formatDecls(rest.map((d) => (d.property === property ? { property, value } : d)));
	};
	const distance = (a, b) => {
		let row = [...Array(b.length + 1).keys()];
		for (let i = 1; i <= a.length; i++) {
			const next = [i];
			for (let j = 1; j <= b.length; j++) {
				next[j] = Math.min(
					row[j] + 1,
					next[j - 1] + 1,
					row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
				);
			}
			row = next;
		}
		return row[b.length];
	};
	const closest = (name) =>
		[...PROPERTIES].map((p) => [distance(name, p), p]).sort((x, y) => x[0] - y[0])[0];
	// The problems of a declaration list, as texts.
	const issuesOf = (css) =>
		parseDecls(css).flatMap((d) => {
			if (d.property === "") return [`"${d.text}" isn't a declaration (property: value)`];
			if (d.value === "") return [`${d.property} has no value`];
			if (d.property.startsWith("--") || PROPERTIES.has(d.property)) return [];
			const [n, near] = closest(d.property);
			return [`unknown property "${d.property}"${n <= 2 ? `: did you mean "${near}"?` : ""}`];
		});
	const declsText = (css) => parseDecls(css).filter((d) => d.property !== "");
	// The number of tracks a grid-template-columns/rows value makes, or "auto".
	const tracksOf = (value) => {
		let n = 0;
		for (const token of splitTop(value, " ")) {
			if (token.startsWith("[")) continue;
			const rep = token.match(/^repeat\(\s*([^,]+),(.*)\)$/s);
			if (rep === null) n++;
			else if (!/^\d+$/.test(rep[1].trim())) return "auto";
			else n += Number(rep[1]) * (tracksOf(rep[2]) === "auto" ? 1 : tracksOf(rep[2]));
		}
		return n;
	};
	const selectorOf = (item, i) =>
		/^[A-Za-z_][\w-]*$/.test(item.id) ? `.${item.id}` : `.item-${i + 1}`;
	const block = (selector, decls) =>
		`${selector} {\n${decls.map((d) => `  ${d.property}: ${d.value};`).join("\n")}\n}`;

	const CssItem = component({
		name: "CssItem",
		fields: { id: t.string(), label: t.string(), css: t.string() },
		view: div(
			{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-2" },
			div(
				{ class: "join w-full" },
				span(
					{ class: "join-item flex items-center bg-base-200 px-2 font-mono text-xs" },
					field("id"),
				),
				input({
					class: "input input-sm input-bordered join-item flex-1",
					"aria-label": "Label",
					value: field("label"),
					"on:input": send("editLabel", targetValue()),
				}),
			),
			textarea({
				class: "textarea textarea-bordered w-full font-mono text-xs",
				rows: 2,
				"aria-label": "Item CSS",
				value: field("css"),
				"on:input": send("editCss", targetValue()),
			}),
		),
		on: {
			// What the root changes.
			set_label: {
				pure: true,
				args: [t.string()],
				run(next, [label]) {
					next.label = label;
				},
			},
			set_css: {
				pure: true,
				args: [t.string()],
				run(next, [css]) {
					next.css = css;
				},
			},
			editLabel: {
				args: [t.string()],
				emits: { notify: ["set_item_label"] },
				run(_next, [text], ctx) {
					ctx.notify("set_item_label", [this.id, text]);
				},
			},
			editCss: {
				args: [t.string()],
				emits: { notify: ["set_item_css"] },
				run(_next, [css], ctx) {
					ctx.notify("set_item_css", [this.id, css]);
				},
			},
		},
	});

	// Sets the container's property: display is its own field, the rest are declarations.
	const setProperty = (self, next, property, value) => {
		claim(self, next);
		if (property === "display") {
			next.display = value;
			next.containerCss = withProperty(self.containerCss, "display", "");
		} else next.containerCss = withProperty(self.containerCss, property, value);
	};
	// The first edit of an empty lab makes its container part.
	const claim = (self, next) => {
		if (self.containerId === "") next.containerId = "container";
	};
	// next with message name(...args) applied to the item with id.
	const toItem = (self, next, id, name, ...args) => {
		const i = self.items.items.findIndex((x) => x.id === id);
		next.items.items[i] = apply(next.items.items[i], name, ...args);
	};
	const IS_PROPERTY = /^(--)?[a-z][a-z-]*$/;
	// The generated CSS's view: plain text with a Copy button.
	const cssViewArgs = (css) =>
		kit.ui.jsonViewArgs(css, { label: "Generated CSS", id: "css", json: false });
	// handlers that, after they run, give the CSS view the CSS they make.
	const withCss = (handlers) =>
		Object.fromEntries(
			Object.entries(handlers).map(([name, h]) => [
				name,
				{
					...h,
					// A pure handler stays pure.
					run: h.pure
						? function (next, args) {
								h.run.call(this, next, args);
								if (next.cssView.text !== next.css)
									next.cssView = apply(next.cssView, "set_text", next.css);
							}
						: function (next, args, ctx) {
								h.run.call(this, next, args, ctx);
								if (next.cssView.text !== next.css)
									next.cssView = apply(next.cssView, "set_text", next.css);
							},
				},
			]),
		);

	// The item list's handlers: drag to reorder (the preview's order), remove, add, reorder_items.
	// The add button is like add_item with no label or CSS (it makes the container too).
	const itemList = listHandlers("items", {
		make: (self, ctx, next) => {
			claim(self, next);
			const id = nextId("item-", self.items.items);
			return ctx.scope.make("CssItem", { id, label: id, css: "" });
		},
	});

	const CssLayoutLab = component({
		name: "CssLayoutLab",
		fields: {
			containerId: t.string(), // The container part's id; "" until there is one.
			display: t.string("grid"),
			containerCss: t.string(),
			items: t.component("List"),
			cssView: t.component("JsonView"), // The generated CSS (plain text, with Copy).
		},
		methods: {
			itemById(id) {
				return this.items.items.find((x) => x.id === id);
			},
			toDomain() {
				return {
					container: { display: this.display, css: this.containerCss },
					items: this.items.items.map(({ id, label, css }) => ({ id, label, css })),
				};
			},
		},
		queries: {
			get containerStyle() {
				return `display: ${this.display}; ${declsText(this.containerCss)
					.map((d) => `${d.property}: ${d.value}`)
					.join("; ")}`;
			},
			get previewItems() {
				return this.items.items.map((x) => ({ label: x.label || x.id, style: x.css }));
			},
			// Every problem, as { text } with what it is about first.
			get issues() {
				const out = [];
				if (!DISPLAYS.includes(this.display))
					out.push(`container: display "${this.display}" isn't one of ${DISPLAYS.join(", ")}`);
				for (const text of issuesOf(this.containerCss)) out.push(`container: ${text}`);
				for (const x of this.items.items)
					for (const text of issuesOf(x.css)) out.push(`${x.id}: ${text}`);
				return out.map((text) => ({ text }));
			},
			get selects() {
				const decls = declsText(this.containerCss);
				const current = (p) =>
					p === "display" ? this.display : (decls.findLast((d) => d.property === p)?.value ?? "");
				return SELECTS.map(({ property, values }) => ({
					property,
					options: [...new Set([...values, current(property)])].map((v) => ({
						value: v,
						text: v || "(unset)",
						selected: v === current(property),
					})),
				}));
			},
			get inputs() {
				const decls = declsText(this.containerCss);
				return INPUTS.map((property) => ({
					property,
					value: decls.findLast((d) => d.property === property)?.value ?? "",
				}));
			},
			// view tool: the layout as a stylesheet.
			get css() {
				const container = block(".container", [
					{ property: "display", value: this.display },
					...declsText(this.containerCss),
				]);
				const items = this.items.items.map((x, i) => {
					const sel = selectorOf(x, i);
					const note = x.label && `.${x.label}` !== sel ? `/* ${x.label} */\n` : "";
					return `${note}${block(sel, declsText(x.css))}`;
				});
				return [container, ...items].join("\n");
			},
			// view tool: the container's declarations and tracks, each item's and the problems.
			get layout_summary() {
				const decls = declsText(this.containerCss);
				const value = (p) => decls.findLast((d) => d.property === p)?.value;
				const grid = this.display.endsWith("grid");
				return {
					display: this.display,
					container: Object.fromEntries(decls.map((d) => [d.property, d.value])),
					...(grid
						? {
								columns: tracksOf(value("grid-template-columns") ?? ""),
								rows: tracksOf(value("grid-template-rows") ?? ""),
							}
						: {
								direction: value("flex-direction") ?? "row",
								wrap: value("flex-wrap") ?? "nowrap",
							}),
					items: this.items.items.map((x) => ({
						id: x.id,
						label: x.label,
						css: Object.fromEntries(declsText(x.css).map((d) => [d.property, d.value])),
					})),
					issues: this.issues.map((i) => i.text),
				};
			},
			get issueList() {
				return this.issues.map((i) => i.text);
			},
			get headline() {
				return `${this.display} · ${this.items.items.length} items · ${this.issues.length} warnings`;
			},
			get summary() {
				return [
					`CSS layout: ${this.headline}.`,
					`items: ${this.items.items.map((x) => `${x.id} (${x.label})`).join(", ") || "none"}`,
					...this.issues.map((i) => `warning: ${i.text}`),
					"css:",
					this.css,
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("CSS layout lab"),
			div(
				{
					class: "min-h-48 rounded-box border border-dashed border-base-300 bg-base-200 p-2",
					style: field("containerStyle"),
				},
				each(
					field("previewItems"),
					div(
						{
							class:
								"rounded bg-primary/20 p-2 font-mono text-sm outline outline-1 outline-dashed outline-primary",
							style: field("style"),
						},
						field("label"),
					),
				),
			),
			messageList("issueList", "text-warning"),
			section("Container"),
			div(
				{ class: "flex flex-wrap gap-2" },
				each(
					field("selects"),
					label(
						{ class: "flex flex-col text-xs" },
						field("property"),
						select(
							{
								class: "select select-bordered select-sm",
								"on:change": send("set_select", sourceKey(), targetValue()),
							},
							each(
								field("options"),
								option({ value: field("value"), selected: field("selected") }, field("text")),
							),
						),
					),
				),
				each(
					field("inputs"),
					label(
						{ class: "flex flex-col text-xs" },
						field("property"),
						input({
							class: "input input-sm input-bordered font-mono",
							value: field("value"),
							"on:change": send("set_input", sourceKey(), targetValue()),
						}),
					),
				),
			),
			textarea({
				class: "textarea textarea-bordered w-full font-mono text-xs",
				rows: 5,
				"aria-label": "Container CSS",
				value: field("containerCss"),
				"on:input": send("set_container_css", targetValue()),
			}),
			section("Items"),
			render(field("items")),
			render(field("cssView")),
		),
		on: withCss({
			...itemList,
			set_container_css: {
				pure: true,
				args: [t.string()],
				run(next, [css]) {
					claim(this, next);
					next.containerCss = css;
				},
			},
			set_container_property: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (_self, [property]) => IS_PROPERTY.test(property),
				run(next, [property, value]) {
					setProperty(this, next, property.trim(), value.trim());
				},
			},
			set_select: {
				pure: true,
				args: [t.number().int().min(0), t.string()],
				run(next, [i, value]) {
					if (SELECTS[i] !== undefined) setProperty(this, next, SELECTS[i].property, value);
				},
			},
			set_input: {
				pure: true,
				args: [t.number().int().min(0), t.string()],
				run(next, [i, value]) {
					if (INPUTS[i] !== undefined) setProperty(this, next, INPUTS[i], value.trim());
				},
			},
			set_item_css: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.itemById(id) !== undefined,
				run(next, [id, css]) {
					toItem(this, next, id, "set_css", css);
				},
			},
			set_item_label: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.itemById(id) !== undefined,
				run(next, [id, text]) {
					toItem(this, next, id, "set_label", text);
				},
			},
			add_item: {
				args: [t.string(), t.string()],
				run(next, [text, css], ctx) {
					claim(this, next);
					const id = nextId("item-", this.items.items);
					const item = ctx.scope.make("CssItem", { id, label: text || id, css });
					next.items = apply(next.items, "add_item", item);
				},
			},
			remove_item: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.itemById(id) !== undefined,
				run(next, [id]) {
					const i = this.items.items.findIndex((x) => x.id === id);
					next.items = apply(next.items, "remove_item_at", i);
				},
			},
		}),
	});

	// How the chat shows a call that sets declarations: one line with them, in CSS
	// (glimpse(arguments)), and how many warnings they make (warningsOf(arguments)), opening
	// to the warnings.
	const declsCall = (name, glimpse, warningsOf) =>
		component({
			name,
			fields: { ...kit.ui.toolCallFields },
			queries: kit.ui.toolCallQueriesWith({
				get args() {
					return this.call?.arguments ?? {};
				},
				get glimpse() {
					return glimpse(this.args);
				},
				get warningList() {
					return this.result && !this.result.isError ? warningsOf(this.args) : [];
				},
				get state() {
					if (!this.result) return "running";
					if (this.result.isError) return this.resultText || "failed";
					const n = this.warningList.length;
					return n === 0 ? "no warnings" : `${n} warning${n === 1 ? "" : "s"}`;
				},
				// Amber when the declarations make warnings.
				get stateClass() {
					return this.warningList.length > 0
						? kit.ui.callStateClass(this.result).replace("badge-success", "badge-warning")
						: kit.ui.callStateClass(this.result);
				},
			}),
			view: kit.ui.toolCallFrame("glimpse", messageList("warningList", "text-warning")),
		});
	const str = (v) => (typeof v === "string" ? v : "");
	// set_container_property: "gap: 1rem", or "gap removed".
	const SetPropertyCall = declsCall(
		"SetPropertyCall",
		({ property, value }) =>
			str(value).trim() === "" ? `${str(property)} removed` : `${str(property)}: ${str(value)}`,
		({ property, value }) => {
			const [p, v] = [str(property).trim(), str(value).trim()];
			if (v === "") return [];
			if (p === "display")
				return DISPLAYS.includes(v) ? [] : [`display "${v}" isn't one of ${DISPLAYS.join(", ")}`];
			return issuesOf(`${p}: ${v}`);
		},
	);
	// set_item_css: "aside { grid-area: aside; align-self: start; }".
	const SetItemCssCall = declsCall(
		"SetItemCssCall",
		({ id, css }) => `${str(id)} { ${str(css).replace(/\s+/g, " ").trim()} }`,
		({ css }) => issuesOf(str(css)),
	);

	// The root for msg: its first container part and its items.
	const decode = (C, bindings, msg) => {
		const container = (bindings.containers ?? kidsOf(msg, "css-container"))[0];
		const fields = {
			containerId: container?.id ?? "",
			display: strOf(container, "display") || "grid",
			containerCss: strOf(container, "css"),
			items: listOf(
				C,
				"items",
				(bindings.items ?? kidsOf(msg, "css-item")).map((m) =>
					C.CssItem({ id: m.id, label: strOf(m, "label"), css: strOf(m, "css") }),
				),
				{ addLabel: "Item" },
			),
		};
		const cssView = C.JsonView(cssViewArgs(C.CssLayoutLab(fields).css));
		return C.CssLayoutLab({ ...fields, cssView });
	};

	// m with the keys of values that differ set (a key it doesn't have reads as ""), or m itself
	// when none does.
	const withStrings = (m, values) =>
		withData(m, Object.fromEntries(Object.entries(values).filter(([k, v]) => strOf(m, k) !== v)));
	const strings = (values) => new Map(Object.entries(values));

	// msg with root's container and items. Unchanged parts stay the same objects; removed items
	// go, new ones are added at the end (after a new container), the item parts follow the items'
	// order, and parts of other kinds stay where they are.
	const encode = (root, msg) => {
		const withContainer = withPart(
			msg,
			"css-container",
			root.containerId,
			// A container without display opened as a grid: write display only when it changed.
			(m) =>
				withStrings(m, {
					...((strOf(m, "display") || "grid") === root.display ? {} : { display: root.display }),
					css: root.containerCss,
				}),
			() =>
				root.containerId === ""
					? null
					: message(
							root.containerId,
							"css-container",
							strings({ display: root.display, css: root.containerCss }),
						),
		);
		return encodeParts(withContainer, {
			"css-item": {
				items: root.items.items,
				update: (m, x) => withStrings(m, { label: x.label, css: x.css }),
				create: (x) => message(x.id, "css-item", strings({ label: x.label, css: x.css })),
				ordered: true,
			},
		});
	};

	return {
		components: { ...kit.ui.components, CssItem, CssLayoutLab, SetPropertyCall, SetItemCssCall },
		root: "CssLayoutLab",
		decode,
		encode,
		toolViews: { set_container_property: "SetPropertyCall", set_item_css: "SetItemCssCall" },
	};
}
