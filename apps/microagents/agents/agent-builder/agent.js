// agent-builder: makes and edits micro-agents. Its data is an agent message (kind
// "microagent"): the manifest with its tq query, the prompt, the skills, the tools, the module
// and the samples. Each change is checked as the app would check it (kit.agents.check): the
// query parses, the module defines an agent, every sample matches and round-trips, every tool
// lines up with the module. The preview opens a sample with the module being written. Install
// registers the agent in this app; the TData tab exports it as a file to drop anywhere.
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
	const { decodeMessage, encodeMessage } = kit.tdata;
	const { agentMessage, unpackAgent, EMPTY_SAMPLE, MANIFEST_KEYS, check, reportText } = kit.agents;
	const { a, div, h2, input, label, li, p, span, textarea, ul } = tag;
	const { listHandlers, listOf, messageList } = kit.ui;

	const TABS = [
		"manifest",
		"query",
		"prompt",
		"skills",
		"tools",
		"module",
		"samples",
		"preview",
		"check",
	];
	const TAB_NAMES = {
		manifest: "Manifest",
		query: "Query",
		prompt: "Prompt",
		skills: "Skills",
		tools: "Tools",
		module: "Module",
		samples: "Samples",
		preview: "Preview",
		check: "Check",
	};
	const FIELD_KIND = ["message", "view", "module"];

	// A sample: its id and its TData JSON text, which its editable JsonView edits (it notifies the
	// root's edit_sample with [id, text]).
	const SampleCase = component({
		name: "SampleCase",
		fields: { id: t.string(), text: t.string(), view: t.component("JsonView") },
		queries: {
			get error() {
				try {
					decodeMessage(this.text);
					return "";
				} catch (error) {
					return error.message;
				}
			},
			get hasError() {
				return this.error !== "";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-2" },
			div(
				{ class: "flex items-center gap-2" },
				span({ class: "font-mono font-semibold" }, field("id")),
			),
			render(field("view")),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		),
		on: {
			// What the root changes: its text, which its view shows.
			set_text: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					next.text = text;
					next.view = apply(next.view, "set_text", text);
				},
			},
		},
	});

	// An editable JsonView of text: its edits notify the root's handler on with [id, text].
	const editorArgs = (id, label, text, on, rows) => ({
		id,
		label,
		text,
		mode: "tree",
		editable: true,
		on,
		rows,
	});
	// A SampleCase for { id, text }, made with make(name, values) (C's or a scope's).
	const sampleCase = (make, { id, text }) =>
		make("SampleCase", {
			id,
			text,
			view: make("JsonView", editorArgs(id, "Sample TData", text, "edit_sample", 4)),
		});
	const toolsJson = (tools) => JSON.stringify(tools, null, 1);

	// The agent's parts as plain values, from a builder (this, never a draft).
	const partsOf = (self) => ({
		manifest: Object.fromEntries(MANIFEST_KEYS.map((k) => [k, self[k]])),
		prompt: self.prompt,
		skills: { ...self.skills },
		tools: self.tools.map((tool) => ({ ...tool })),
		module: self.module,
		samples: self.samples.items.map((s) => ({ id: s.id, text: s.text })),
	});
	// The agent message for parts; samples that aren't TData are left out (the check says so).
	const messageOf = (parts) =>
		agentMessage({
			...parts,
			samples: parts.samples.flatMap((s) => {
				try {
					return [{ id: s.id, message: decodeMessage(s.text) }];
				} catch {
					return [];
				}
			}),
		});
	// Asks for a check of parts, with a preview of sample.
	const recheck = (ctx, parts, sample) => ctx.ask("checkAgent", [parts, sample]);

	// The sample list: drag to reorder (the order the agent's samples are written in), remove,
	// add (an empty TData) and reorder_samples. The remove button is checked like remove_sample.
	const sampleList = listHandlers("samples", {
		removed: (self, _next, item, ctx) => {
			const samples = self.parts.samples.filter((s) => s.id !== item.id);
			recheck(ctx, { ...self.parts, samples }, self.previewSample);
		},
		make: (self, ctx) =>
			sampleCase((n, v) => ctx.scope.make(n, v), {
				id: kit.lib.parts.nextId("sample", self.samples.items),
				text: '{"id":"x","kind":"x","messages":[]}',
			}),
	});

	const AgentBuilder = component({
		name: "AgentBuilder",
		fields: {
			id: t.string(),
			title: t.string(),
			description: t.string(),
			needs: t.string(),
			icon: t.string(),
			version: t.string(),
			query: t.string(),
			prompt: t.string(),
			skills: t.map(t.string()),
			tools: t.array(t.any()),
			module: t.string(),
			samples: t.component("List"),
			tab: t.enum(...TABS),
			skillPath: t.string(),
			newSkillPath: t.string(),
			toolsView: t.component("JsonView"), // The tools as JSON, being edited.
			toolsError: t.string(),
			previewSample: t.string(),
			report: t.array(t.any()), // The last check: [{ ok, label, detail }].
			checking: t.boolean(),
			preview: t.option(t.component()),
			notice: t.string(),
		},
		methods: {
			// view tools: the files the model reads before changing them.

			toDomain() {
				return this.parts;
			},
		},
		queries: {
			read_module() {
				return this.module;
			},
			read_sample(id) {
				return this.samples.items.find((s) => s.id === id)?.text ?? { error: `no sample ${id}` };
			},

			get parts() {
				return partsOf(this);
			},
			get tabs() {
				return TABS.map((id) => ({
					label: TAB_NAMES[id],
					cls: `tab ${id === this.tab ? "tab-active" : ""}`,
				}));
			},
			get onManifest() {
				return this.tab === "manifest";
			},
			get onQuery() {
				return this.tab === "query";
			},
			get onPrompt() {
				return this.tab === "prompt";
			},
			get onSkills() {
				return this.tab === "skills";
			},
			get onTools() {
				return this.tab === "tools";
			},
			get onModule() {
				return this.tab === "module";
			},
			get onSamples() {
				return this.tab === "samples";
			},
			get onPreview() {
				return this.tab === "preview";
			},
			get onCheck() {
				return this.tab === "check";
			},
			get skillPaths() {
				return Object.keys(this.skills).map((path) => ({
					path,
					cls: `btn btn-xs ${path === this.skillPath ? "btn-active" : "btn-ghost"}`,
				}));
			},
			get skillText() {
				return this.skills[this.skillPath] ?? "";
			},
			get sampleIds() {
				return this.samples.items.map((s) => ({
					id: s.id,
					cls: `btn btn-xs ${s.id === this.previewSample ? "btn-active" : "btn-ghost"}`,
				}));
			},
			get hasNotice() {
				return this.notice !== "";
			},
			get toolsText() {
				return this.toolsView.text;
			},
			get hasToolsError() {
				return this.toolsError !== "";
			},
			get hasPreview() {
				return this.preview !== null;
			},
			get noPreview() {
				return this.preview === null;
			},
			get failures() {
				return this.report.filter((i) => !i.ok).length;
			},
			get ok() {
				return this.report.length > 0 && this.failures === 0;
			},
			get status() {
				if (this.checking) return "checking…";
				if (this.report.length === 0) return "not checked yet";
				return this.failures === 0
					? `all ${this.report.length} checks pass`
					: `${this.failures} of ${this.report.length} checks fail`;
			},
			get statusClass() {
				return `badge ${this.checking || this.report.length === 0 ? "badge-ghost" : this.failures === 0 ? "badge-success" : "badge-error"}`;
			},
			get reportRows() {
				return this.report.map((i) => ({
					mark: i.ok ? "✓" : "✗",
					cls: i.ok ? "text-success" : "text-error",
					label: i.label,
					detail: i.detail,
				}));
			},
			get queryRows() {
				return this.reportRows.filter((r) => r.label.includes("query"));
			},
			// view tool: the check report as text.
			get check_report() {
				return reportText(this.report) || "not checked yet: call check";
			},
			get summary() {
				const tools = this.tools.map((x) => `${x.name} (${x.kind})`).join(", ") || "none";
				return [
					`Agent ${this.id || "(no id)"}: ${this.title || "(no title)"} ${this.icon}, version ${this.version}`,
					`needs: ${this.needs}`,
					`query: ${this.query}`,
					`skills: ${Object.keys(this.skills).join(", ") || "none"}`,
					`tools: ${tools}`,
					`samples: ${this.samples.items.map((s) => s.id).join(", ") || "none"}`,
					`module: ${this.module.split("\n").length} lines`,
					`check: ${this.status}`,
					...this.report
						.filter((i) => !i.ok)
						.map((i) => `  FAIL ${i.label}${i.detail ? `: ${i.detail}` : ""}`),
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-3" },
			div(
				{ class: "flex flex-wrap items-center gap-2" },
				h2(
					{ class: "text-lg font-semibold" },
					"🛠️ Agent Builder: ",
					span({ class: "font-normal" }, field("icon"), " ", field("title")),
				),
				span({ class: field("statusClass") }, field("status")),
				span({ class: "flex-1" }),
				button({ class: "btn btn-sm", "on:click": send("check") }, "Check"),
				button({ class: "btn btn-sm btn-primary", "on:click": send("install") }, "Install"),
			),
			$if(field("hasNotice"), p({ class: "alert text-sm" }, field("notice")), ""),
			div(
				{ role: "tablist", class: "tabs tabs-bordered" },
				each(
					field("tabs"),
					a(
						{ role: "tab", class: field("cls"), "on:click": send("set_tab", sourceKey()) },
						field("label"),
					),
				),
			),
			$if(
				field("onManifest"),
				div(
					{ class: "grid gap-2 md:grid-cols-2" },
					...["id", "title", "icon", "version", "description", "needs"].map((k) =>
						label(
							{ class: "flex flex-col gap-1 text-sm" },
							span({ class: "opacity-70" }, k),
							input({
								class: "input input-sm input-bordered",
								value: field(k),
								"on:input": send("set_manifest", k, targetValue()),
							}),
						),
					),
				),
				"",
			),
			$if(
				field("onQuery"),
				div(
					{ class: "flex flex-col gap-2" },
					p(
						{ class: "text-sm opacity-70" },
						"A tq query: it matches when it yields a truthy output, and its bindings ($name) go to decode.",
					),
					textarea({
						class: "textarea textarea-bordered font-mono text-sm",
						rows: 4,
						"aria-label": "Query",
						value: field("query"),
						"on:input": send("edit_query", targetValue()),
					}),
					button(
						{ class: "btn btn-sm self-start", "on:click": send("check") },
						"Try it on the samples",
					),
					ul(
						{ class: "text-sm" },
						each(
							field("queryRows"),
							li(
								{ class: field("cls") },
								field("mark"),
								" ",
								field("label"),
								" ",
								span({ class: "opacity-70" }, field("detail")),
							),
						),
					),
				),
				"",
			),
			$if(
				field("onPrompt"),
				textarea({
					class: "textarea textarea-bordered text-sm",
					rows: 14,
					"aria-label": "System prompt",
					value: field("prompt"),
					"on:input": send("set_prompt", targetValue()),
				}),
				"",
			),
			$if(
				field("onSkills"),
				div(
					{ class: "flex flex-col gap-2" },
					div(
						{ class: "flex flex-wrap gap-1" },
						each(
							field("skillPaths"),
							button(
								{ class: field("cls"), "on:click": send("pick_skill", sourceKey()) },
								field("path"),
							),
						),
					),
					textarea({
						class: "textarea textarea-bordered font-mono text-xs",
						rows: 14,
						"aria-label": "Skill file",
						value: field("skillText"),
						"on:input": send("edit_skill", targetValue()),
					}),
					div(
						{ class: "join" },
						input({
							class: "input input-sm input-bordered join-item",
							placeholder: "reference/new.md",
							"aria-label": "New skill path",
							value: field("newSkillPath"),
							"on:input": send("set_new_skill_path", targetValue()),
						}),
						button({ class: "btn btn-sm join-item", "on:click": send("add_skill") }, "Add file"),
						button(
							{
								class: "btn btn-sm btn-ghost join-item",
								"on:click": send("remove_current_skill"),
							},
							"Remove this file",
						),
					),
				),
				"",
			),
			$if(
				field("onTools"),
				div(
					{ class: "flex flex-col gap-2" },
					p(
						{ class: "text-sm opacity-70" },
						"[{ name, kind: message | view | module, description, params, result? }]: a message tool is a handler on the root with that name.",
					),
					render(field("toolsView")),
					$if(field("hasToolsError"), p({ class: "text-sm text-error" }, field("toolsError")), ""),
					button({ class: "btn btn-sm self-start", "on:click": send("apply_tools") }, "Apply"),
				),
				"",
			),
			$if(
				field("onModule"),
				div(
					{ class: "flex flex-col gap-2" },
					textarea({
						class: "textarea textarea-bordered font-mono text-xs leading-snug",
						rows: 24,
						spellcheck: "false",
						"aria-label": "Module",
						value: field("module"),
						"on:input": send("edit_module", targetValue()),
					}),
					button({ class: "btn btn-sm self-start", "on:click": send("check") }, "Check"),
				),
				"",
			),
			$if(field("onSamples"), render(field("samples")), ""),
			$if(
				field("onPreview"),
				div(
					{ class: "flex flex-col gap-2" },
					div(
						{ class: "flex flex-wrap gap-1" },
						each(
							field("sampleIds"),
							button(
								{ class: field("cls"), "on:click": send("pick_preview", sourceKey()) },
								field("id"),
							),
						),
					),
					$if(
						field("noPreview"),
						p(
							{ class: "text-sm opacity-70" },
							"No preview: check the agent (the module must load and the sample decode).",
						),
						"",
					),
					$if(
						field("hasPreview"),
						div(
							{ class: "rounded-box border border-dashed border-base-300 p-3" },
							render(field("preview")),
						),
						"",
					),
				),
				"",
			),
			$if(
				field("onCheck"),
				ul(
					{ class: "flex flex-col gap-1 text-sm" },
					each(
						field("reportRows"),
						li(
							{ class: field("cls") },
							field("mark"),
							" ",
							field("label"),
							" ",
							span({ class: "opacity-70" }, field("detail")),
						),
					),
				),
				"",
			),
		),
		on: {
			...sampleList,
			set_tab: {
				pure: true,
				args: [
					t
						.number()
						.int()
						.min(0)
						.max(TABS.length - 1),
				],
				run(next, [i]) {
					next.tab = TABS[i];
				},
			},
			// message tools: each change is checked.
			set_manifest: {
				args: [t.enum("id", "title", "description", "needs", "icon", "version"), t.string()],
				run(next, [key, value], ctx) {
					next[key] = value;
					recheck(
						ctx,
						{ ...this.parts, manifest: { ...this.parts.manifest, [key]: value } },
						this.previewSample,
					);
				},
			},
			set_query: {
				args: [t.string()],
				run(next, [query], ctx) {
					next.query = query;
					recheck(
						ctx,
						{ ...this.parts, manifest: { ...this.parts.manifest, query } },
						this.previewSample,
					);
				},
			},
			set_prompt: {
				pure: true,
				args: [t.string()],
				run(next, [prompt]) {
					next.prompt = prompt;
				},
			},
			write_skill: {
				pure: true,
				args: [t.string().len(1), t.string()],
				run(next, [path, text]) {
					next.skills[path] = text;
					next.skillPath = path;
				},
			},
			remove_skill: {
				pure: true,
				args: [t.string()],
				pre: (self, [path]) => path in self.skills,
				run(next, [path]) {
					delete next.skills[path];
					if (this.skillPath === path)
						next.skillPath = Object.keys(this.skills).find((p) => p !== path) ?? "";
				},
			},
			upsert_tool: {
				args: [t.any()],
				pre: (_self, [tool]) =>
					typeof tool?.name === "string" && tool.name !== "" && FIELD_KIND.includes(tool.kind),
				run(next, [tool], ctx) {
					const tools = [...this.tools.filter((x) => x.name !== tool.name), { ...tool }];
					const at = this.tools.findIndex((x) => x.name === tool.name);
					if (at >= 0) tools.splice(at, 0, tools.pop());
					next.tools = tools;
					next.toolsView = apply(next.toolsView, "set_text", toolsJson(tools));
					recheck(ctx, { ...this.parts, tools }, this.previewSample);
				},
			},
			remove_tool: {
				args: [t.string()],
				pre: (self, [name]) => self.tools.some((x) => x.name === name),
				run(next, [name], ctx) {
					const tools = this.tools.filter((x) => x.name !== name);
					next.tools = tools;
					next.toolsView = apply(next.toolsView, "set_text", toolsJson(tools));
					recheck(ctx, { ...this.parts, tools }, this.previewSample);
				},
			},
			write_module: {
				args: [t.string()],
				run(next, [module], ctx) {
					next.module = module;
					recheck(ctx, { ...this.parts, module }, this.previewSample);
				},
			},
			upsert_sample: {
				args: [t.string().len(1), t.string()],
				run(next, [id, text], ctx) {
					const at = this.samples.items.findIndex((s) => s.id === id);
					if (at >= 0) next.samples.items[at] = apply(next.samples.items[at], "set_text", text);
					else {
						const sample = sampleCase((n, v) => ctx.scope.make(n, v), { id, text });
						next.samples = apply(next.samples, "add_item", sample);
					}
					const samples =
						at >= 0
							? this.parts.samples.map((s) => (s.id === id ? { id, text } : s))
							: [...this.parts.samples, { id, text }];
					const preview =
						id === EMPTY_SAMPLE && this.previewSample !== "" ? this.previewSample : id;
					next.previewSample = preview;
					recheck(ctx, { ...this.parts, samples }, preview);
				},
			},
			remove_sample: {
				args: [t.string()],
				pre: (self, [id]) => self.samples.items.some((s) => s.id === id),
				run(next, [id], ctx) {
					const at = this.samples.items.findIndex((s) => s.id === id);
					next.samples = apply(next.samples, "remove_item_at", at);
					recheck(
						ctx,
						{ ...this.parts, samples: this.parts.samples.filter((s) => s.id !== id) },
						this.previewSample,
					);
				},
			},
			check: {
				args: [],
				run(next, _args, ctx) {
					next.checking = true;
					recheck(ctx, this.parts, this.previewSample);
				},
			},
			install: {
				args: [],
				emits: { ask: ["installAgent"] },
				run(next, _args, ctx) {
					next.notice = "installing…";
					ctx.ask("installAgent", [messageOf(this.parts)]);
				},
			},
			replace_domain: {
				args: [t.any()],
				run(next, [parts], ctx) {
					Object.assign(next, fieldsOf(ctx.scope.components, parts));
					recheck(ctx, parts, this.previewSample);
				},
			},
			// The page's edits: typed text isn't checked on every key.
			edit_query: {
				pure: true,
				args: [t.string()],
				run(next, [query]) {
					next.query = query;
				},
			},
			edit_module: {
				pure: true,
				args: [t.string()],
				run(next, [module]) {
					next.module = module;
				},
			},
			// A sample's JsonView: [id, text].
			edit_sample: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [id, text]) {
					const at = this.samples.items.findIndex((s) => s.id === id);
					if (at < 0) return;
					next.samples.items[at] = apply(next.samples.items[at], "set_text", text);
				},
			},
			pick_skill: {
				pure: true,
				args: [t.number().int().min(0)],
				run(next, [i]) {
					next.skillPath = Object.keys(this.skills)[i] ?? "";
				},
			},
			edit_skill: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					if (this.skillPath !== "") next.skills[this.skillPath] = text;
				},
			},
			set_new_skill_path: {
				pure: true,
				args: [t.string()],
				run(next, [path]) {
					next.newSkillPath = path;
				},
			},
			add_skill: {
				pure: true,
				args: [],
				run(next) {
					const path = this.newSkillPath.trim();
					if (path === "" || path in this.skills) return;
					next.skills[path] = "";
					next.skillPath = path;
					next.newSkillPath = "";
				},
			},
			remove_current_skill: {
				pure: true,
				args: [],
				run(next) {
					if (!(this.skillPath in this.skills)) return;
					delete next.skills[this.skillPath];
					next.skillPath = Object.keys(this.skills).find((p) => p !== this.skillPath) ?? "";
				},
			},
			// The tools' JsonView: [id, text]. Apply takes them.
			edit_tools: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [_id, text]) {
					next.toolsView = apply(next.toolsView, "set_text", text);
				},
			},
			apply_tools: {
				args: [],
				run(next, _args, ctx) {
					const { value, error } = kit.lib.json.parse(this.toolsText);
					if (error !== "" || !Array.isArray(value)) {
						next.toolsError = error || "the tools must be an array";
						return;
					}
					const tools = structuredClone(value); // parse's value is shared
					next.tools = tools;
					next.toolsError = "";
					recheck(ctx, { ...this.parts, tools }, this.previewSample);
				},
			},
			pick_preview: {
				args: [t.number().int().min(0)],
				run(next, [i], ctx) {
					const id = this.samples.items[i]?.id;
					if (id === undefined) return;
					next.previewSample = id;
					recheck(ctx, this.parts, id);
				},
			},
		},
		answers: {
			checkAgent: {
				ok(next, [{ items, preview }]) {
					next.report = items;
					next.preview = preview;
					next.checking = false;
				},
				error(next, [error]) {
					next.report = [
						{ ok: false, label: "the check ran", detail: String(error?.message ?? error) },
					];
					next.preview = null;
					next.checking = false;
				},
				unhandled(next) {
					next.checking = false;
				},
			},
			installAgent: {
				ok(next, [{ title }]) {
					next.notice = `Installed ${title}: it's on the launcher now.`;
				},
				error(next, [error]) {
					next.notice = `It didn't install: ${error?.message ?? error}`;
				},
				unhandled(next) {
					next.notice = "This page can't install agents.";
				},
			},
		},
	});

	// The builder's fields for an agent's parts (with samples as SampleCases).
	const fieldsOf = (C, parts) => ({
		...Object.fromEntries(MANIFEST_KEYS.map((k) => [k, String(parts.manifest[k] ?? "")])),
		prompt: parts.prompt,
		skills: { ...parts.skills },
		tools: parts.tools,
		toolsView: C.JsonView(
			editorArgs("tools", "Tools JSON", toolsJson(parts.tools), "edit_tools", 14),
		),
		module: parts.module,
		samples: listOf(
			C,
			"samples",
			parts.samples.map((s) => sampleCase((n, v) => C[n](v), s)),
			{ addLabel: "Sample" },
		),
	});

	const decode = (C, _bindings, msg) => {
		const parts = unpackAgent(msg);
		const skillPaths = Object.keys(parts.skills);
		const preview = parts.samples.find((s) => s.id !== EMPTY_SAMPLE)?.id ?? EMPTY_SAMPLE;
		return C.AgentBuilder({
			...fieldsOf(C, {
				...parts,
				samples: parts.samples.map((s) => ({ id: s.id, text: encodeMessage(s.message) })),
			}),
			tab: "manifest",
			skillPath: skillPaths.includes("SKILL.md") ? "SKILL.md" : (skillPaths[0] ?? ""),
			previewSample: preview,
			preview: null,
			report: [],
		});
	};

	// The agent message for the builder: parts that encode as they did keep the original's
	// objects, parts of kinds an agent doesn't have stay, and the meta is the original's.
	const encode = (root, original) => {
		const built = messageOf(root.parts);
		const old = original.messages ?? [];
		const same = (m) =>
			old.find((o) => o.kind === m.kind && o.id === m.id && encodeMessage(o) === encodeMessage(m));
		const kinds = new Set(built.messages.map((m) => m.kind));
		const kids = [
			...built.messages.map((m) => same(m) ?? m),
			...old.filter((o) => !kinds.has(o.kind)),
		];
		if (
			original.id === built.id &&
			kids.length === old.length &&
			kids.every((k, i) => k === old[i])
		)
			return original;
		return { ...built, messages: kids, meta: original.meta ?? built.meta };
	};

	// The check, answered here: the agent the parts make, checked, and the preview sample
	// opened with its module (in a scope of its own).
	const asks = {
		checkAgent: async ([parts, sampleId]) => {
			const msg = messageOf(parts);
			const result = await check(msg);
			const items = [...result.items];
			for (const s of parts.samples) {
				try {
					decodeMessage(s.text);
				} catch (error) {
					items.push({ ok: false, label: `sample ${s.id} is TData`, detail: error.message });
				}
			}
			let preview = null;
			const sample = result.parts?.samples.find((s) => s.id === sampleId);
			if (result.def !== null && sample !== undefined) {
				try {
					const found = kit.tdata.queries.match(result.parts.manifest.query, sample.message);
					preview = result.def.decode(
						result.scope.components,
						found ? Object.fromEntries(found.bindings) : {},
						sample.message,
					);
				} catch (error) {
					items.push({
						ok: false,
						label: `the preview of ${sampleId} opens`,
						detail: error.message,
					});
				}
			}
			return { items, preview };
		},
	};

	// How the chat shows a call answered with the check (write_module, upsert_tool, check): what
	// it changed and whether the checks pass, opening to the ones that fail.
	const CheckCall = component({
		name: "CheckCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get what() {
				const args = this.call?.arguments ?? {};
				if (this.toolName === "write_module")
					return `${String(args.source ?? "").split("\n").length} lines`;
				if (this.toolName === "upsert_tool")
					return `${args.tool?.name ?? "?"} (${args.tool?.kind ?? "?"})`;
				return "";
			},
			// The report's lines: "ok  label" or "FAIL label: detail".
			get lines() {
				return this.resultText
					.split("\n")
					.filter((l) => l.startsWith("ok  ") || l.startsWith("FAIL "));
			},
			get failing() {
				return this.lines.filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5));
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				const n = this.lines.length;
				if (n === 0) return "not checked";
				const f = this.failing.length;
				return f === 0 ? `all ${n} checks pass` : `${f} of ${n} checks fail`;
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, this.failing.length > 0);
			},
		}),
		view: kit.ui.toolCallFrame("what", messageList("failing")),
	});

	return {
		components: { ...kit.ui.components, SampleCase, AgentBuilder, CheckCall },
		root: "AgentBuilder",
		decode,
		encode,
		asks,
		toolViews: { write_module: "CheckCall", upsert_tool: "CheckCall", check: "CheckCall" },
	};
}
