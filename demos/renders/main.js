// The Renders demo: a story's component live on the left, and on the right what else it
// renders, rendered again after each render of the page: renders.tui as a terminal shows it
// (<tutuca-terminal>, the same app: what's done in it runs on the page's host), renders.js as
// the code it prints (tutuca/jsast), renders.md as the markdown it prints (tutuca/mdast), raw and
// through <md-view>, renders.ps as the PostScript it prints (tutuca/ps) and an SVG preview of
// it, and as a PDF (tutuca/pdf) in a frame, renders.docx as a Word file (tutuca/docx) to download
// and an HTML preview of it, renders.llmContext as what a model is told (tutuca/llm) and renders.llmTools
// as the tools it's given, which a form calls as a model would. The story is in the hash,
// #Counter/From zero. The cart, the kanban board and the JSON tree nest: each component's
// renders put its children's where they go, and a child's tools are its parent's.
import { compile } from "margaui";
import jsonBook from "../../components/json/stories.js";
import kanbanBook from "../../components/kanban/stories.js";
import "../../components/markdown/element.js";
import cart from "../../site/examples/composed.js";
import counter from "../../site/examples/counter.js";
import todoList from "../../site/examples/todo-list.js";
import { ClassCompiler, classNamesOf } from "../../src/css/classes.js";
import { DOCX_MIME, printDocx, renderDocxTree } from "../../src/docx/index.js";
import { renderJs } from "../../src/jsast/index.js";
import { callLlmTool, renderLlmContext, renderLlmTools } from "../../src/llm/index.js";
import { renderMd } from "../../src/mdast/index.js";
import { printPdf } from "../../src/pdf/index.js";
import { printPs, renderPsTree } from "../../src/ps/index.js";
import { defineTutucaTerminal } from "../../src/tui/element.js";
import { DevChecks } from "../../src/tutuca.dev.js";
import { Host, isProblem, specOf } from "../../src/tutuca.js";
import { previewDocx } from "./docx-preview.js";
import { previewPs } from "./ps-preview.js";

const books = [counter, todoList, cart, kanbanBook, jsonBook];
// The ones that make their state: the rest generate it.
const stories = books.flatMap((book) => book.stories.filter((story) => story.make !== undefined));

const el = (document, tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
	node.append(...children);
	return node;
};
const pane = (document, title, body) =>
	el(document, "div", {}, el(document, "h3", {}, title), body);
const mdPanes = (document, title) => {
	const raw = el(document, "pre");
	const view = el(document, "md-view");
	const node = el(
		document,
		"div",
		{ class: "render-panes" },
		pane(document, title, raw),
		pane(document, "Rendered", view),
	);
	return { node, raw, view };
};
const showMd = ({ raw, view }, text) => {
	raw.textContent = text;
	// md-view reads its content attribute, before it's defined and after.
	view.setAttribute("content", text);
};

// An input for a tool's schema to start from: each param's first value, or an empty one.
const EMPTY = { string: "", number: 0, integer: 0, boolean: false, array: [] };
const sampleInput = ({ properties }) =>
	Object.fromEntries(
		Object.entries(properties).map(([name, p]) => [name, p.enum?.[0] ?? EMPTY[p.type] ?? null]),
	);
// A call's outcome, as a tool result would tell the model.
const callText = (call) => `→ ${call.name}(${call.args.map((a) => JSON.stringify(a)).join(", ")})`;

// A file to download, made again after each render: its link's URL is the last one made, the one
// before let go of. A file's made asynchronously; one made after a later one started is dropped.
const download = (document, label) => {
	const link = el(document, "a", { class: "btn btn-sm", hidden: "" }, label);
	let url = null;
	let made = 0;
	const set = async (bytes, type, name) => {
		const mine = ++made;
		const data = await bytes;
		if (mine !== made) return null;
		const URL = document.defaultView?.URL ?? globalThis.URL;
		if (url !== null) URL.revokeObjectURL?.(url);
		url = URL.createObjectURL?.(new Blob([data], { type })) ?? null;
		if (url !== null) link.setAttribute("href", url);
		link.setAttribute("download", name);
		link.hidden = false;
		return { data, url };
	};
	return { link, set };
};

// The renders this page shows, in this order, by target (or the target they say). make builds a
// panel, attach(panel, host) starts it on the page's host once it's on the page, show(panel,
// instance) fills it, returning a promise when it does so asynchronously.
const SHOWN = {
	tui: {
		title: "Terminal",
		make: (document) => {
			const terminal = el(document, "tutuca-terminal", { rows: "16" });
			const hint = el(
				document,
				"p",
				{ class: "renders-hint" },
				"Click it to use it: Tab moves focus, Enter and space press.",
			);
			return { node: el(document, "div", {}, terminal, hint), terminal, mirror: null };
		},
		attach: (made, host) => {
			made.mirror = made.terminal.show(host);
		},
		show: (made) => made.mirror?.sync(),
	},
	js: {
		title: "JavaScript",
		make: (document) => {
			const code = el(document, "code");
			return { node: pane(document, "renders.js", el(document, "pre", {}, code)), code };
		},
		show: ({ code }, instance) => {
			code.textContent = renderJs(instance);
		},
	},
	md: {
		title: "Markdown",
		make: (document) => mdPanes(document, "renders.md"),
		show: (made, instance) => showMd(made, renderMd(instance)),
	},
	ps: {
		title: "PostScript",
		make: (document) => {
			const code = el(document, "pre", { class: "render-scroll" });
			const pages = el(document, "div", { class: "ps-pages" });
			const node = el(
				document,
				"div",
				{ class: "render-panes" },
				pane(document, "renders.ps", code),
				pane(document, "Previewed", pages),
			);
			return { node, code, pages };
		},
		show: ({ code, pages }, instance) => {
			const tree = renderPsTree(instance);
			code.textContent = printPs(tree);
			pages.replaceChildren(...previewPs(pages.ownerDocument, tree));
		},
	},
	pdf: {
		target: "ps",
		title: "PDF",
		make: (document) => {
			const frame = el(document, "iframe", { class: "pdf-frame", title: "PDF" });
			const file = download(document, "Download PDF");
			return { node: el(document, "div", { class: "pdf-pane" }, file.link, frame), frame, file };
		},
		show: async ({ frame, file }, instance) => {
			const name = `${specOf(instance).name}.pdf`;
			const made = await file.set(printPdf(renderPsTree(instance)), "application/pdf", name);
			if (made?.url) frame.setAttribute("src", made.url);
		},
	},
	docx: {
		title: "Word",
		make: (document) => {
			const preview = el(document, "div", { class: "docx-preview" });
			const file = download(document, "Download .docx");
			return { node: el(document, "div", {}, file.link, preview), preview, file };
		},
		show: async ({ preview, file }, instance) => {
			const tree = renderDocxTree(instance);
			preview.replaceChildren(...previewDocx(preview.ownerDocument, tree));
			await file.set(printDocx(tree), DOCX_MIME, `${specOf(instance).name}.docx`);
		},
	},
	llmContext: {
		title: "LLM context",
		make: (document) => mdPanes(document, "renders.llmContext"),
		show: (made, instance) => showMd(made, renderLlmContext(instance)),
	},
	llmTools: {
		title: "LLM tools",
		make: (document) => {
			const json = el(document, "pre", { class: "render-scroll" });
			const tool = el(document, "select", { "aria-label": "Tool" });
			const input = el(document, "textarea", {
				rows: "4",
				spellcheck: "false",
				"aria-label": "Input",
			});
			const call = el(document, "button", { type: "submit", class: "btn btn-primary" }, "Call");
			const result = el(document, "pre", { class: "render-result", hidden: "" });
			const form = el(document, "form", { class: "render-call" }, tool, input, call, result);
			const node = el(
				document,
				"div",
				{ class: "render-panes" },
				pane(document, "renders.llmTools", json),
				pane(document, "Call one, as a model would", form),
			);
			return { node, json, tool, input, call, result, form, tools: [] };
		},
		attach: (made, host) => {
			const fill = () => {
				const tool = made.tools.find((t) => t.name === made.tool.value);
				made.input.value = tool ? JSON.stringify(sampleInput(tool.input_schema)) : "";
			};
			made.fill = fill;
			made.tool.addEventListener("change", fill);
			made.form.addEventListener("submit", (e) => {
				e.preventDefault();
				made.result.hidden = false;
				made.result.classList.remove("render-error");
				try {
					const input = made.input.value.trim() === "" ? {} : JSON.parse(made.input.value);
					made.result.textContent = callText(callLlmTool(host, { name: made.tool.value, input }));
				} catch (error) {
					made.result.classList.add("render-error");
					made.result.textContent = (error.issues ?? [error.message]).join("\n");
				}
			});
		},
		// The tools follow the state: the ones offered, and what each takes.
		show: (made, instance) => {
			const tools = renderLlmTools(instance);
			made.tools = tools;
			made.json.textContent = JSON.stringify(tools, null, 2);
			const picked = made.tool.value;
			const names = tools.map((t) => t.name);
			made.tool.replaceChildren(
				...names.map((name) => el(made.tool.ownerDocument, "option", { value: name }, name)),
			);
			made.call.disabled = names.length === 0;
			if (names.includes(picked)) made.tool.value = picked;
			else made.fill?.();
		},
	},
};

// The panels for the targets spec renders; filled again by update.
// The panels collapsed, by name: they stay so from story to story, and in this browser from visit
// to visit when it keeps them.
const COLLAPSED_KEY = "tutuca-renders-collapsed";
const loadCollapsed = (window) => {
	try {
		return new Set(JSON.parse(window?.localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
	} catch {
		return new Set();
	}
};
const saveCollapsed = (window, collapsed) => {
	try {
		window?.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
	} catch {
		// Kept for this visit only.
	}
};

// A panel whose title collapses and expands it; with Ctrl (⌘ on a Mac), every panel.
const collapsible = (document, container, collapsed, name, title, ...children) => {
	const panel = el(
		document,
		"details",
		{ class: "render", "data-panel": name },
		el(
			document,
			"summary",
			{ title: "Click to collapse or expand; Ctrl+click (⌘+click) for every panel" },
			el(document, "h2", {}, title),
		),
		...children,
	);
	panel.open = !collapsed.has(name);
	panel.firstChild.addEventListener("click", (e) => {
		e.preventDefault();
		const open = !panel.open;
		const all = e.ctrlKey || e.metaKey;
		for (const each of all ? container.querySelectorAll("details.render") : [panel]) {
			each.open = open;
			if (open) collapsed.delete(each.dataset.panel);
			else collapsed.add(each.dataset.panel);
		}
		saveCollapsed(document.defaultView, collapsed);
	});
	return panel;
};

const mountOthers = (document, container, spec, host, collapsed) => {
	container.replaceChildren();
	const panels = [];
	for (const [name, shown] of Object.entries(SHOWN)) {
		if (spec.renders[shown.target ?? name] === undefined) continue;
		const made = shown.make(document);
		const error = el(document, "pre", { class: "render-error", hidden: "" });
		container.append(
			collapsible(document, container, collapsed, name, shown.title, made.node, error),
		);
		shown.attach?.(made, host);
		panels.push({ shown, made, error });
	}
	if (panels.length === 0) {
		container.append(el(document, "p", { class: "renders-none" }, "It renders only its views."));
	}
	return (instance) => {
		const fail = (error, e) => {
			error.textContent = String(e.message ?? e);
			error.hidden = false;
		};
		for (const { shown, made, error } of panels) {
			try {
				const shows = shown.show(made, instance);
				error.hidden = true;
				shows?.catch((e) => fail(error, e));
			} catch (e) {
				fail(error, e);
			}
		}
	};
};

export const start = (document = globalThis.document) => {
	const window = document.defaultView;
	if (window !== null) defineTutucaTerminal(window);
	const select = document.getElementById("story");
	const app = document.getElementById("app");
	const others = document.getElementById("others");
	// A group per book, its stories by name.
	for (const book of books) {
		const group = el(document, "optgroup", { label: book.title });
		for (const story of stories.filter((s) => s.book === book)) {
			group.append(el(document, "option", { value: story.id }, story.name));
		}
		select.append(group);
	}
	const classes = new ClassCompiler(
		compile,
		classNamesOf(books.flatMap((b) => Object.values(b.components))),
	);
	const style = document.getElementById("margaui");
	if (style !== null) classes.watch(style);

	const collapsed = loadCollapsed(window);
	let host = null;
	const open = (id) => {
		const story = stories.find((s) => s.id === id) ?? stories[0];
		select.value = story.id;
		host?.stop();
		// A fresh element for each host, so the last one's DOM and listeners go with it.
		const rootNode = el(document, "div");
		app.replaceChildren(rootNode);
		host = new Host({ document, rootNode, checks: DevChecks });
		host.scope.register(story.book.components);
		host.scope.registerAskHandlers(story.book.askHandlers);
		const root = story.make(host.scope.components);
		const update = mountOthers(document, others, specOf(root), host, collapsed);
		host.listen((record) => {
			if (isProblem(record)) console.error(record.outcome ?? record.type, record);
			if (record.type === "rendered") update(host.root);
		});
		host.start(root);
		update(host.root);
	};
	const fromHash = () => decodeURIComponent(window?.location.hash.slice(1) ?? "");
	select.addEventListener("change", () => {
		if (window !== null) window.location.hash = encodeURIComponent(select.value);
		else open(select.value);
	});
	window?.addEventListener("hashchange", () => open(fromHash()));
	open(fromHash());
	// The host of the story shown, and opening another (as picking it does).
	return { host: () => host, open };
};

if (globalThis.document?.getElementById("app")) start();
