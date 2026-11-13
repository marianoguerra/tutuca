// The Renders demo: a story's component live on the left, and on the right what else it
// renders, rendered again after each render of the page: renders.tui as a terminal shows it
// (<tutuca-terminal>, the same app: what's done in it runs on the page's host), renders.js as
// the code it prints (tutuca/jsast), renders.md as the markdown it prints (tutuca/mdast), raw and
// through <md-view>, renders.llmContext as what a model is told (tutuca/llm) and renders.llmTools
// as the tools it's given, which a form calls as a model would. The story is in the hash,
// #Counter/From zero.
import { compile } from "margaui";
import "../../components/markdown/element.js";
import counter from "../../site/examples/counter.js";
import todoList from "../../site/examples/todo-list.js";
import { ClassCompiler, classNamesOf } from "../../src/css/classes.js";
import { renderJs } from "../../src/jsast/index.js";
import { callLlmTool, renderLlmContext, renderLlmTools } from "../../src/llm/index.js";
import { renderMd } from "../../src/mdast/index.js";
import { defineTutucaTerminal } from "../../src/tui/element.js";
import { DevChecks } from "../../src/tutuca.dev.js";
import { Host, isProblem, specOf } from "../../src/tutuca.js";

const books = [counter, todoList];
const stories = books.flatMap((book) => book.stories);

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

// The renders this page shows, by target, in this order. make builds a panel, attach(panel, host)
// starts it on the page's host once it's on the page, show(panel, instance) fills it.
const SHOWN = {
	tui: {
		title: "Terminal",
		make: (document) => {
			const terminal = el(document, "tutuca-terminal", { rows: "12" });
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
	llmContext: {
		title: "LLM context",
		make: (document) => mdPanes(document, "renders.llmContext"),
		show: (made, instance) => showMd(made, renderLlmContext(instance)),
	},
	llmTools: {
		title: "LLM tools",
		make: (document) => {
			const json = el(document, "pre");
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
const mountOthers = (document, container, spec, host) => {
	container.replaceChildren();
	const panels = [];
	for (const [target, shown] of Object.entries(SHOWN)) {
		if (spec.renders[target] === undefined) continue;
		const made = shown.make(document);
		const error = el(document, "pre", { class: "render-error", hidden: "" });
		container.append(
			el(
				document,
				"section",
				{ class: "render" },
				el(document, "h2", {}, shown.title),
				made.node,
				error,
			),
		);
		shown.attach?.(made, host);
		panels.push({ shown, made, error });
	}
	if (panels.length === 0) {
		container.append(el(document, "p", { class: "renders-none" }, "It renders only its views."));
	}
	return (instance) => {
		for (const { shown, made, error } of panels) {
			try {
				shown.show(made, instance);
				error.hidden = true;
			} catch (e) {
				error.textContent = String(e.message ?? e);
				error.hidden = false;
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
	for (const story of stories) select.append(el(document, "option", { value: story.id }, story.id));
	const classes = new ClassCompiler(
		compile,
		classNamesOf(books.flatMap((b) => Object.values(b.components))),
	);
	const style = document.getElementById("margaui");
	if (style !== null) classes.watch(style);

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
		const update = mountOthers(document, others, specOf(root), host);
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
