// blockkit-lab: a Slack message payload ({ blocks: [...] }) built block by block. The block list
// reorders (drag) and removes, the editor changes the selected block as JSON or through its main text,
// and the preview renders the blocks the way Slack shows them, with a small mrkdwn subset
// (*bold*, _italic_, ~strike~, `code`, <url|label> links, newlines) as elements. Every block is
// checked against Slack's limits. The page's buttons send the root's handlers, the same ones the
// model's tools send.
export default function define(kit) {
	const {
		apply,
		button,
		component,
		each,
		field,
		$if,
		render,
		send,
		sourceKey,
		t,
		tag,
		targetValue,
	} = kit.tutuca;
	const { message, toJson, fromJson } = kit.tdata;
	const { a, details, div, hr, img, input, p, span, summary } = tag;
	const { isObject: isObj, parse, pretty } = kit.lib.json;
	const { nextId } = kit.lib.parts;
	const { addButton, labHeader, listHandlers, listOf, messageList, section } = kit.ui;

	const TEMPLATES = {
		section: { type: "section", text: { type: "mrkdwn", text: "*New section* with _mrkdwn_" } },
		header: { type: "header", text: { type: "plain_text", text: "New header" } },
		divider: { type: "divider" },
		context: { type: "context", elements: [{ type: "mrkdwn", text: "Some context" }] },
		actions: {
			type: "actions",
			elements: [
				{ type: "button", text: { type: "plain_text", text: "Click me" }, action_id: "button_1" },
			],
		},
		image: { type: "image", image_url: "https://placehold.co/600x200.png", alt_text: "An image" },
		input: {
			type: "input",
			label: { type: "plain_text", text: "Label" },
			element: { type: "plain_text_input", action_id: "input_1" },
		},
	};
	const TYPES = Object.keys(TEMPLATES);

	// A block from a tool argument: an object, or JSON text of one; null when it isn't a block.
	// (Parsed text is shared by kit.lib.json.parse, so a block from text is a copy of it.)
	const asBlock = (value) => {
		const v = typeof value === "string" ? parse(value).value : value;
		if (!isObj(v) || typeof v.type !== "string") return null;
		return typeof value === "string" ? structuredClone(v) : v;
	};
	const textOf = (o) => (isObj(o) && typeof o.text === "string" ? o.text : "");

	// Slack escapes &, < and > in text; the preview shows them as typed.
	const unescapeText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
	const seg = (text, cls, href = "") => ({
		text: unescapeText(text),
		cls,
		href,
		isLink: href !== "",
	});
	const link = (target, label, cls) => {
		const mention = "rounded bg-info/20 px-0.5 text-info";
		if (target.startsWith("@")) return seg(`@${label ?? target.slice(1)}`, `${cls} ${mention}`);
		if (target.startsWith("#")) return seg(`#${label ?? target.slice(1)}`, `${cls} ${mention}`);
		if (target.startsWith("!"))
			return seg(`@${target.slice(1).split("^")[0]}`, `${cls} ${mention}`);
		return seg(label ?? target, `${cls} link link-info`, target);
	};
	const TOKEN = /`([^`\n]+)`|<([^>|\n]+)(?:\|([^>\n]+))?>|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
	// mrkdwn text as segments { text, cls, href, isLink }; styles nest by adding classes.
	const mrkdwn = (text, cls = "") => {
		const out = [];
		let at = 0;
		for (const m of text.matchAll(TOKEN)) {
			if (m.index > at) out.push(seg(text.slice(at, m.index), cls));
			if (m[1] !== undefined)
				out.push(seg(m[1], `${cls} rounded bg-base-200 px-1 font-mono text-error`));
			else if (m[2] !== undefined) out.push(link(m[2], m[3], cls));
			else if (m[4] !== undefined) out.push(...mrkdwn(m[4], `${cls} font-bold`));
			else if (m[5] !== undefined) out.push(...mrkdwn(m[5], `${cls} italic`));
			else out.push(...mrkdwn(m[6], `${cls} line-through`));
			at = m.index + m[0].length;
		}
		if (at < text.length) out.push(seg(text.slice(at), cls));
		return out;
	};
	const segsOf = (o) =>
		isObj(o) && o.type === "mrkdwn" ? mrkdwn(textOf(o)) : [seg(textOf(o), "")];
	const plainOf = (o) =>
		segsOf(o)
			.map((s) => (s.isLink && s.href !== s.text ? `${s.text} (${s.href})` : s.text))
			.join("");

	const BUTTON = { primary: "btn btn-sm btn-success", danger: "btn btn-sm btn-error" };
	const buttonOf = (e) => ({
		label: textOf(e?.text) || e?.type || "?",
		cls: BUTTON[e?.style] ?? "btn btn-sm btn-outline",
	});
	// One block as the preview draws it; every key is there so the view can read any of them.
	const previewOf = (b, index, selected) => {
		const kind = TYPES.includes(b?.type) ? b.type : "other";
		const acc = b?.accessory;
		return {
			index,
			frameCls: `cursor-pointer rounded px-2 py-1 ${index === selected ? "outline outline-2 outline-primary" : "hover:bg-base-200"}`,
			isHeader: kind === "header",
			isDivider: kind === "divider",
			isSection: kind === "section",
			isContext: kind === "context",
			isActions: kind === "actions",
			isImage: kind === "image",
			isInput: kind === "input",
			isOther: kind === "other",
			title: kind === "other" ? `(${b?.type ?? "not a block"})` : textOf(b.text),
			segs: segsOf(b?.text),
			fields: (Array.isArray(b?.fields) ? b.fields : []).map((f) => ({ segs: segsOf(f) })),
			accButtons: acc?.type === "button" ? [buttonOf(acc)] : [],
			accImages:
				acc?.type === "image" ? [{ url: acc.image_url ?? "", alt: acc.alt_text ?? "" }] : [],
			elements: (kind === "context" ? (b.elements ?? []) : []).map((e) => ({
				isImage: e?.type === "image",
				url: e?.image_url ?? "",
				alt: e?.alt_text ?? "",
				segs: e?.type === "image" ? [] : segsOf(e),
			})),
			buttons: (kind === "actions" ? (b.elements ?? []) : []).map(buttonOf),
			imageUrl: b?.image_url ?? "",
			imageAlt: b?.alt_text ?? "",
			imageTitle: textOf(b?.title),
			label: textOf(b?.label),
			placeholder: textOf(b?.element?.placeholder),
			multiline: b?.element?.multiline === true,
		};
	};

	// Problems with Slack's limits: { index, path, message }; index -1 is the whole message.
	const problemsOf = (blocks) => {
		const out = [];
		const ids = new Map();
		const check = (b, index) => {
			const bad = (path, message) => out.push({ index, path: `blocks[${index}]${path}`, message });
			const text = (o, path, { max, plain = false, required = true } = {}) => {
				if (o === undefined) return required ? bad(path, "is required") : undefined;
				if (!isObj(o) || !["plain_text", "mrkdwn"].includes(o.type))
					return bad(path, "must be a text object ({type: plain_text or mrkdwn, text})");
				if (plain && o.type !== "plain_text") bad(`${path}.type`, "must be plain_text");
				if (typeof o.text !== "string" || o.text === "")
					bad(`${path}.text`, "must be a non-empty string");
				else if (o.text.length > max)
					bad(`${path}.text`, `is ${o.text.length} characters, more than ${max}`);
			};
			const max = (v, path, n) =>
				typeof v === "string" &&
				v.length > n &&
				bad(path, `is ${v.length} characters, more than ${n}`);
			const button = (e, path) => {
				text(e.text, `${path}.text`, { max: 75, plain: true });
				if (e.style !== undefined && !["primary", "danger"].includes(e.style))
					bad(`${path}.style`, "must be primary or danger");
				max(e.action_id, `${path}.action_id`, 255);
				max(e.url, `${path}.url`, 3000);
				max(e.value, `${path}.value`, 2000);
			};
			if (!isObj(b)) return bad("", "must be an object");
			if (b.block_id !== undefined) {
				max(b.block_id, ".block_id", 255);
				if (ids.has(b.block_id))
					bad(".block_id", `"${b.block_id}" is also block ${ids.get(b.block_id)}'s id`);
				else ids.set(b.block_id, index);
			}
			const els = Array.isArray(b.elements) ? b.elements : [];
			switch (b.type) {
				case "header":
					return text(b.text, ".text", { max: 150, plain: true });
				case "divider":
					return;
				case "section":
					if (b.text === undefined && b.fields === undefined)
						return bad("", "needs text or fields");
					if (b.text !== undefined) text(b.text, ".text", { max: 3000 });
					if (b.fields !== undefined) {
						if (!Array.isArray(b.fields)) return bad(".fields", "must be a list");
						if (b.fields.length > 10) bad(".fields", `has ${b.fields.length} fields, more than 10`);
						for (const [i, f] of b.fields.entries()) text(f, `.fields[${i}]`, { max: 2000 });
					}
					if (b.accessory?.type === "button") button(b.accessory, ".accessory");
					if (b.accessory?.type === "image" && !b.accessory.image_url)
						bad(".accessory.image_url", "is required");
					return;
				case "context":
					if (els.length === 0 || els.length > 10) bad(".elements", "must have 1 to 10 elements");
					for (const [i, e] of els.entries()) {
						if (e?.type !== "image") text(e, `.elements[${i}]`, { max: 2000 });
						else if (!e.image_url) bad(`.elements[${i}].image_url`, "is required");
					}
					return;
				case "actions": {
					if (els.length === 0 || els.length > 25)
						bad(".elements", `must have 1 to 25 elements, has ${els.length}`);
					const seen = new Set();
					for (const [i, e] of els.entries()) {
						if (e?.type === "button") button(e, `.elements[${i}]`);
						if (e?.action_id !== undefined && seen.has(e.action_id))
							bad(`.elements[${i}].action_id`, `"${e.action_id}" is used twice in the block`);
						seen.add(e?.action_id);
					}
					return;
				}
				case "image":
					if (typeof b.image_url !== "string" || b.image_url === "")
						bad(".image_url", "is required");
					max(b.image_url, ".image_url", 3000);
					if (typeof b.alt_text !== "string" || b.alt_text === "") bad(".alt_text", "is required");
					max(b.alt_text, ".alt_text", 2000);
					return text(b.title, ".title", { max: 2000, plain: true, required: false });
				case "input":
					text(b.label, ".label", { max: 2000, plain: true });
					if (!isObj(b.element)) bad(".element", "is required");
					return text(b.hint, ".hint", { max: 2000, plain: true, required: false });
				default:
					return bad(
						".type",
						`"${b.type}" isn't a block type this lab knows (${TYPES.join(", ")})`,
					);
			}
		};
		for (const [index, b] of blocks.entries()) check(b, index);
		if (blocks.length > 50)
			out.unshift({
				index: -1,
				path: "blocks",
				message: `has ${blocks.length} blocks, more than 50`,
			});
		return out;
	};

	// A block as plain text, one or more lines.
	const lineOf = (b) => {
		switch (b?.type) {
			case "header":
				return `# ${textOf(b.text)}`;
			case "divider":
				return "----";
			case "section":
				return [
					b.text ? plainOf(b.text) : null,
					...(b.fields ?? []).map((f) => `  ${plainOf(f).replace(/\n/g, " ")}`),
					b.accessory?.type === "button" ? `[${textOf(b.accessory.text)}]` : null,
				]
					.filter((x) => x !== null)
					.join("\n");
			case "context":
				return (b.elements ?? [])
					.map((e) => (e?.type === "image" ? `(${e.alt_text ?? "image"})` : plainOf(e)))
					.join(" · ");
			case "actions":
				return (b.elements ?? []).map((e) => `[${textOf(e?.text) || e?.type}]`).join(" ");
			case "image":
				return `[image: ${b.alt_text ?? ""}]`;
			case "input":
				return `${textOf(b.label)}: [${textOf(b.element?.placeholder) || "…"}]`;
			default:
				return `(${b?.type ?? "?"})`;
		}
	};

	// The block's main text: what the quick text field edits. path is where it lives.
	const MAIN = {
		section: ["text", "text"],
		header: ["text", "text"],
		context: ["elements", 0, "text"],
		actions: ["elements", 0, "text", "text"],
		image: ["alt_text"],
		input: ["label", "text"],
	};
	const getPath = (o, path) =>
		path.reduce((v, k) => (v === null || typeof v !== "object" ? undefined : v[k]), o);

	const inRange = (self, i) => Number.isInteger(i) && i >= 0 && i < self.blocks.length;
	const move = (next, from, to) => {
		next.rows = apply(next.rows, "move_item", from, to);
		next.selected = to;
		next.draft = "";
	};
	const blocksOf = (rows) => rows.map((r) => r.block);
	// A new row for block, with the next free (page-only) id.
	const newRow = (self, ctx, block) =>
		ctx.scope.make("BlockRow", {
			id: nextId("b", self.rows.items),
			block,
			index: 0,
			selected: false,
			bad: false,
		});
	// The selected block as the editor shows it: the draft being typed, or the block's JSON.
	const editorTextOf = ({ draft, rows: { items: rows }, selected }) =>
		draft !== ""
			? draft
			: Number.isInteger(selected) && selected >= 0 && selected < rows.length
				? pretty(rows[selected].block)
				: "";
	// next's JsonViews (the block editor and the payload) and its rows' index, selection and
	// problem mark showing next's state; every handler that changes the blocks, the selection or
	// the draft ends with it.
	const sync = (next) => {
		const blocks = blocksOf(next.rows.items);
		next.editor = apply(next.editor, "set_text", editorTextOf(next));
		next.payloadView = apply(next.payloadView, "set_text", pretty({ ...next.extra, blocks }));
		const bad = new Set(problemsOf(blocks).map((x) => x.index));
		next.rows.items.forEach((r, i) => {
			const selected = i === next.selected;
			if (r.index !== i || r.selected !== selected || r.bad !== bad.has(i))
				next.rows.items[i] = apply(r, "mark", i, selected, bad.has(i));
		});
	};
	// The list's handlers (drag, the remove button; the add buttons pick a type, so the list has
	// none): after a change the selection stays on the block it was on (none when it went), and
	// the views follow; a drop that changes nothing leaves the draft alone. The model's tools are
	// move_block and remove_block.
	const rowList = listHandlers("rows", {
		changed(self, next) {
			const key = self.rows.items[self.selected]?.id;
			next.selected = key === undefined ? -1 : next.rows.items.findIndex((r) => r.id === key);
			next.draft = "";
			sync(next);
		},
	});

	// A block of the list: plain JSON in block, with a page-only id for the list. index, selected
	// and bad (it breaks a limit) are the root's, set by sync.
	const BlockRow = component({
		name: "BlockRow",
		fields: {
			id: t.string(),
			block: t.any(),
			index: t.number().int(),
			selected: t.boolean(),
			bad: t.boolean(),
		},
		queries: {
			get label() {
				const b = this.block;
				return `${this.index} · ${b?.type ?? "?"}${b?.block_id ? ` #${b.block_id}` : ""}`;
			},
			get cls() {
				return `btn btn-xs w-full justify-start ${this.selected ? "btn-primary" : "btn-ghost"} ${this.bad ? "text-error" : ""}`;
			},
		},
		view: button({ class: field("cls"), "on:click": send("pick") }, field("label")),
		on: {
			// What the root changes: the block, and the marks sync keeps.
			set_block: {
				pure: true,
				args: [t.any()],
				run(next, [block]) {
					next.block = block;
				},
			},
			mark: {
				pure: true,
				args: [t.number().int(), t.boolean(), t.boolean()],
				run(next, [index, selected, bad]) {
					next.index = index;
					next.selected = selected;
					next.bad = bad;
				},
			},
			pick: {
				args: [],
				emits: { notify: ["select"] },
				run(_next, _args, ctx) {
					ctx.notify("select", [this.index]);
				},
			},
		},
	});

	const BlockkitLab = component({
		name: "BlockkitLab",
		fields: {
			partId: t.string(),
			extra: t.any(), // The payload's other keys (text, …), kept as they are.
			rows: t.component("List"), // The blocks (BlockRows), in order.
			selected: t.number().int(), // -1 for none.
			draft: t.string(), // JSON being typed in the editor, "" when it shows the block.
			draftError: t.string(),
			editor: t.component("JsonView"), // The selected block's JSON, editable.
			payloadView: t.component("JsonView"), // The whole payload, read-only.
		},
		methods: {
			toDomain() {
				return { blocks: this.blocks, problems: this.problems };
			},
		},
		queries: {
			get blocks() {
				return blocksOf(this.rows.items);
			},
			get payload() {
				return { ...this.extra, blocks: this.blocks };
			},
			get payloadText() {
				return pretty(this.payload);
			},
			get problems() {
				return problemsOf(this.blocks);
			},
			get problemLines() {
				return this.problems.map((x) => `${x.path}: ${x.message}`);
			},
			get preview_text() {
				return this.blocks.map(lineOf).join("\n");
			},
			get preview() {
				return this.blocks.map((b, i) => previewOf(b, i, this.selected));
			},
			get hasSelection() {
				return inRange(this, this.selected);
			},
			get editorText() {
				return editorTextOf(this);
			},
			get hasDraftError() {
				return this.draftError !== "";
			},
			get quickText() {
				const b = this.blocks[this.selected];
				const v = MAIN[b?.type] ? getPath(b, MAIN[b.type]) : undefined;
				return typeof v === "string" ? v : "";
			},
			get headline() {
				return `${this.blocks.length} blocks · ${this.problems.length} problems`;
			},
			get summary() {
				const problems = this.problems.map((x) => `  ${x.path}: ${x.message}`);
				return [
					`${this.blocks.length} blocks, ${this.problems.length} problems.`,
					...this.blocks.map(
						(b, i) =>
							`  ${i}: ${b?.type ?? "?"}${b?.block_id ? ` (${b.block_id})` : ""} ${JSON.stringify(lineOf(b).slice(0, 80))}`,
					),
					...(problems.length ? ["problems:", ...problems] : []),
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-3" },
			labHeader("Block Kit lab"),
			div(
				{ class: "flex flex-wrap gap-1" },
				...TYPES.map((type) => addButton(type, "add_template", type)),
			),
			div(
				{ class: "grid gap-3 md:grid-cols-2" },
				div(
					{ class: "flex flex-col gap-2" },
					section("Blocks"),
					render(field("rows")),
					$if(
						field("hasSelection"),
						div(
							{ class: "flex flex-col gap-1" },
							input({
								class: "input input-sm input-bordered",
								"aria-label": "Text",
								value: field("quickText"),
								"on:input": send("set_quick_text", targetValue()),
							}),
							render(field("editor")),
							$if(
								field("hasDraftError"),
								p({ class: "text-xs text-error" }, field("draftError")),
								"",
							),
						),
						p({ class: "text-xs opacity-60" }, "Select a block to edit it."),
					),
					messageList("problemLines"),
				),
				div(
					{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-3 text-sm" },
					section("Preview"),
					each(field("preview"), previewView()),
				),
			),
			details(
				{ class: "text-xs" },
				summary(
					{ class: "cursor-pointer opacity-70" },
					"Payload JSON (paste into Block Kit Builder)",
				),
				render(field("payloadView")),
			),
		),
		on: {
			...rowList,
			add_block: {
				args: [t.any(), t.any()],
				pre: (self, [block, index]) =>
					asBlock(block) !== null &&
					(index === undefined ||
						index === null ||
						index === -1 ||
						(Number.isInteger(index) && index >= 0 && index <= self.blocks.length)),
				run(next, [block, index], ctx) {
					const at = Number.isInteger(index) && index >= 0 ? index : this.blocks.length;
					next.rows = apply(next.rows, "add_item", newRow(this, ctx, asBlock(block)));
					if (at < this.blocks.length)
						next.rows = apply(next.rows, "move_item", this.blocks.length, at);
					next.selected = at;
					next.draft = "";
					sync(next);
				},
			},
			set_block: {
				pure: true,
				args: [t.number().int(), t.any()],
				pre: (self, [i, block]) => inRange(self, i) && asBlock(block) !== null,
				run(next, [i, block]) {
					next.rows.items[i] = apply(next.rows.items[i], "set_block", asBlock(block));
					next.draft = "";
					sync(next);
				},
			},
			remove_block: {
				pure: true,
				args: [t.number().int()],
				pre: (self, [i]) => inRange(self, i),
				run(next, [i]) {
					next.rows = apply(next.rows, "remove_item_at", i);
					if (this.selected >= i) next.selected = this.selected === i ? -1 : this.selected - 1;
					next.draft = "";
					sync(next);
				},
			},
			move_block: {
				pure: true,
				args: [t.number().int(), t.number().int()],
				pre: (self, [from, to]) => inRange(self, from) && inRange(self, to),
				run(next, [from, to]) {
					move(next, from, to);
					sync(next);
				},
			},
			add_template: {
				args: [t.enum(...TYPES)],
				run(next, [type], ctx) {
					next.rows = apply(
						next.rows,
						"add_item",
						newRow(this, ctx, structuredClone(TEMPLATES[type])),
					);
					next.selected = this.blocks.length;
					next.draft = "";
					sync(next);
				},
			},
			select: {
				pure: true,
				args: [t.number().int()],
				run(next, [i]) {
					next.selected = i;
					next.draft = "";
					next.draftError = "";
					sync(next);
				},
			},
			// The editor's JSON (its JsonView notifies [id, text]): it replaces the selected block
			// once it parses as a block.
			edit_json: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [_id, text]) {
					if (!this.hasSelection) return;
					next.draft = text;
					const { error } = parse(text);
					const block = error === "" ? asBlock(text) : null;
					next.draftError =
						error !== "" ? error : block === null ? 'a block is an object with a "type"' : "";
					if (block !== null) {
						next.rows.items[this.selected] = apply(
							next.rows.items[this.selected],
							"set_block",
							block,
						);
					}
					sync(next);
				},
			},
			set_quick_text: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					const row = this.rows.items[this.selected];
					const path = MAIN[row?.block?.type];
					if (path === undefined || getPath(row.block, path.slice(0, -1)) === undefined) return;
					const b = structuredClone(row.block);
					getPath(b, path.slice(0, -1))[path.at(-1)] = text;
					next.rows.items[this.selected] = apply(next.rows.items[this.selected], "set_block", b);
					next.draft = "";
					sync(next);
				},
			},
		},
	});

	// The preview of one block (an item of preview).
	function previewView() {
		// Fresh nodes per use: a mrkdwn text's segments and a button chip.
		const segs = () =>
			each(
				field("segs"),
				$if(
					field("isLink"),
					a({ class: field("cls"), href: field("href"), target: "_blank" }, field("text")),
					span({ class: field("cls") }, field("text")),
				),
			);
		const chip = () => span({ class: field("cls") }, field("label"));
		return div(
			{ class: field("frameCls"), "on:click": send("select", sourceKey()) },
			$if(field("isHeader"), p({ class: "text-lg font-bold" }, field("title")), ""),
			$if(field("isDivider"), hr({ class: "my-1 border-base-300" }), ""),
			$if(
				field("isSection"),
				div(
					{ class: "flex gap-3" },
					div(
						{ class: "flex flex-1 flex-col gap-2" },
						p({ class: "whitespace-pre-wrap" }, segs()),
						div(
							{ class: "grid grid-cols-2 gap-2" },
							each(field("fields"), p({ class: "whitespace-pre-wrap" }, segs())),
						),
					),
					each(field("accButtons"), chip()),
					each(
						field("accImages"),
						img({ class: "h-16 w-16 rounded object-cover", src: field("url"), alt: field("alt") }),
					),
				),
				"",
			),
			$if(
				field("isContext"),
				div(
					{ class: "flex flex-wrap items-center gap-2 text-xs opacity-70" },
					each(
						field("elements"),
						$if(
							field("isImage"),
							img({ class: "h-4 w-4 rounded", src: field("url"), alt: field("alt") }),
							span({ class: "whitespace-pre-wrap" }, segs()),
						),
					),
				),
				"",
			),
			$if(
				field("isActions"),
				div({ class: "flex flex-wrap gap-2" }, each(field("buttons"), chip())),
				"",
			),
			$if(
				field("isImage"),
				div(
					{ class: "flex flex-col gap-1" },
					span({ class: "text-xs opacity-70" }, field("imageTitle")),
					img({ class: "max-h-48 rounded", src: field("imageUrl"), alt: field("imageAlt") }),
				),
				"",
			),
			$if(
				field("isInput"),
				div(
					{ class: "flex flex-col gap-1" },
					span({ class: "font-semibold" }, field("label")),
					input({
						class: "input input-sm input-bordered",
						disabled: true,
						placeholder: field("placeholder"),
					}),
				),
				"",
			),
			$if(field("isOther"), span({ class: "text-xs opacity-60" }, field("title")), ""),
		);
	}

	const partOf = (bindings, msg) =>
		bindings.payloads?.[0] ?? (msg.messages ?? []).find((m) => m.kind === "blockkit");
	// The part's data as plain JSON: { extra, blocks }.
	const dataOf = (m) => {
		let json = {};
		try {
			json = m?.data instanceof Map ? toJson(m.data) : {};
		} catch {
			json = {};
		}
		const { blocks, ...extra } = json;
		return { extra, blocks: Array.isArray(blocks) ? blocks : [] };
	};

	const decode = (C, bindings, msg) => {
		const m = partOf(bindings, msg);
		const data = dataOf(m);
		const bad = new Set(problemsOf(data.blocks).map((x) => x.index));
		return C.BlockkitLab({
			partId: m?.id ?? "payload",
			extra: data.extra,
			rows: listOf(
				C,
				"rows",
				data.blocks.map((block, i) =>
					C.BlockRow({ id: `b${i + 1}`, block, index: i, selected: false, bad: bad.has(i) }),
				),
			),
			selected: -1,
			draft: "",
			draftError: "",
			editor: C.JsonView({
				id: "block",
				label: "Block JSON",
				text: "",
				mode: "tree",
				editable: true,
				on: "edit_json",
			}),
			payloadView: C.JsonView(
				kit.ui.jsonViewArgs(pretty({ ...data.extra, blocks: data.blocks }), { label: "Payload" }),
			),
		});
	};

	// msg with the root's blocks: the part stays the same object when its blocks didn't change; a
	// message without one gets it at the end.
	const encode = (root, msg) => {
		const blocks = JSON.parse(JSON.stringify(root.blocks));
		return kit.lib.parts.withPart(
			msg,
			"blockkit",
			root.partId,
			(m) =>
				JSON.stringify(dataOf(m).blocks) === JSON.stringify(blocks)
					? m
					: {
							...m,
							data: new Map([
								...(m.data instanceof Map ? m.data : []),
								["blocks", fromJson(blocks)],
							]),
						},
			() =>
				blocks.length > 0
					? message(root.partId, "blockkit", new Map([["blocks", fromJson(blocks)]]))
					: null,
		);
	};

	// How the chat shows an add_block or set_block call: the block's type, its text as the preview
	// shows it and how many of Slack's limits it breaks, opening to those problems.
	const BlockCall = component({
		name: "BlockCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get block() {
				return asBlock(this.call?.arguments?.block);
			},
			get where() {
				const { index } = this.call?.arguments ?? {};
				return Number.isInteger(index) && index >= 0 ? `at ${index}` : "at the end";
			},
			get type() {
				return this.block?.type ?? "not a block";
			},
			get text() {
				return this.block === null ? "" : lineOf(this.block).replace(/\n/g, " ⏎ ");
			},
			// "header · at the end · # All clear".
			get glimpse() {
				return [this.type, this.where, this.text].filter((x) => x !== "").join(" · ");
			},
			get blockProblems() {
				return this.block === null
					? []
					: problemsOf([this.block]).map(
							(x) => `${x.path.replace(/^blocks\[0\]/, "block")}: ${x.message}`,
						);
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				const n = this.blockProblems.length;
				return n === 0 ? "no problems" : `${n} problem${n === 1 ? "" : "s"}`;
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, this.blockProblems.length > 0);
			},
		}),
		view: kit.ui.toolCallFrame("glimpse", messageList("blockProblems")),
	});

	return {
		components: { ...kit.ui.components, BlockRow, BlockkitLab, BlockCall },
		root: "BlockkitLab",
		decode,
		encode,
		toolViews: { add_block: "BlockCall", set_block: "BlockCall" },
	};
}
