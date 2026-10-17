// <tutuca-playground>: edit a book of stories and run it. The left pane edits the entry
// module and the files it reaches through relative imports, the right pane is the Playground
// component, showing the book's stories live with the storybook's panels. A run links the
// edited files as blob modules (sources.js) and imports them; their imports of tutuca resolve
// to the page's copy, the one the panels run on.
//
// CodeMirror (EditorView, EditorState, Compartment, keymap, basicSetup, javascript, oneDark),
// fast-check and a margaui-style compile(classes) → css are passed in, as in the storybook.

import { ClassCompiler, classNamesOf } from "../dev/classes.js";
import { devClasses, devComponents } from "../dev/panel.js";
import { defineTutucaApp, REQUEST } from "../storybook/element.js";
import { StoryRegistry } from "../storybook/runner.js";
import { BADGES } from "../storybook/ui/common.js";
import { StoryPanel } from "../storybook/ui/story-panel.js";
import { StressPanel } from "../storybook/ui/stress-panel.js";
import { DispatchPath, Host, Target, Task } from "../tutuca.js";
import { booksOf, linkSources, loadSources } from "./sources.js";
import { makePlayground, Playground, storyChoices } from "./ui/playground.js";

export const playgroundComponents = { Playground, StoryPanel, StressPanel, ...devComponents };
export const playgroundClasses = () =>
	classNamesOf(Object.values(playgroundComponents), [...Object.values(BADGES), ...devClasses]);

// Files under src/ are tutuca itself: imported as they are, never edited, so every run
// shares the page's copy.
const SRC_ROOT = new URL("../", import.meta.url).href;
export const isTutucaSource = (url) => url.startsWith(SRC_ROOT);

// What a margaui theme sets. The css compiled for an app defaults them on :host, so a story's
// <tutuca-app> would always be light; inheriting them here keeps the page's theme.
const THEME_VARS = [
	..."base-100 base-200 base-300 base-content".split(" "),
	...["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"].flatMap(
		(name) => [name, `${name}-content`],
	),
]
	.map((name) => `--color-${name}`)
	.concat([
		"--radius-selector",
		"--radius-field",
		"--radius-box",
		"--size-selector",
		"--size-field",
	])
	.concat(["--border", "--depth", "--noise"]);
const INHERIT_THEME = `tutuca-app { color-scheme: inherit; ${THEME_VARS.map((v) => `${v}: inherit;`).join(" ")} }`;

const LAYOUT = `
${INHERIT_THEME}
:host { display: block; height: var(--playground-height, 34rem); container-type: inline-size; }
.pg { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); height: 100%;
	border: 1px solid var(--color-base-300); border-radius: var(--radius-box, 0.5rem);
	overflow: hidden; background: var(--color-base-100); color: var(--color-base-content); }
.pg-editor { display: flex; flex-direction: column; min-height: 0; min-width: 0;
	border-right: 1px solid var(--color-base-300); }
.pg-files { display: flex; gap: 2px; overflow-x: auto; padding: 4px 4px 0;
	background: var(--color-base-200); border-bottom: 1px solid var(--color-base-300); }
.pg-files button { font: 12px ui-monospace, monospace; padding: 4px 8px; border: 0;
	border-radius: 4px 4px 0 0; background: transparent; color: inherit; opacity: 0.7;
	white-space: nowrap; cursor: pointer; }
.pg-files button[aria-selected="true"] { background: var(--color-base-100); opacity: 1; }
.pg-code { flex: 1; min-height: 0; overflow: hidden; }
.pg-code .cm-editor { height: 100%; font-size: 13px; }
.pg-code .cm-editor.cm-focused { outline: none; }
.pg-bar { display: flex; align-items: center; gap: 6px; padding: 6px;
	border-top: 1px solid var(--color-base-300); background: var(--color-base-200); }
.pg-bar .hint { margin-left: auto; font-size: 12px; opacity: 0.6; }
.pg-panel { min-height: 0; min-width: 0; }
.pg-panel > * { height: 100%; }
@container (max-width: 760px) {
	.pg { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
	.pg-editor { border-right: 0; border-bottom: 1px solid var(--color-base-300); }
}
`;

// Sends name(...args) to root's component from outside the app.
const sendRoot = (host, name, args) => {
	const path = new DispatchPath();
	const task = new Task(name, args, path, new Target(path), null);
	host.prepareTask(task, host.rootComponent);
	host.pushTask(task);
};

const errorText = (error) => String(error?.stack ?? error?.message ?? error);

export const definePlayground = (
	window,
	{ codemirror, fc, compile, tagName = "tutuca-playground" },
) => {
	if (window.customElements.get(tagName)) return window.customElements.get(tagName);
	defineTutucaApp(window);
	const { EditorState, EditorView, Compartment, keymap, basicSetup, javascript, oneDark } =
		codemirror;
	const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
	const uiCss = compile(playgroundClasses());

	class TutucaPlayground extends window.HTMLElement {
		// [{ id, title, src }], set with setExamples: shown in a selector.
		examples = [];
		files = [];
		states = new Map(); // url → EditorState, so each file keeps its own undo history.
		current = null;
		linked = null;
		registry = null;
		runs = 0;

		connectedCallback() {
			if (this.shadowRoot !== null) return;
			const root = this.attachShadow({ mode: "open" });
			const { document } = window;
			root.innerHTML = `<style>${LAYOUT}</style><style data-ui></style><style data-ui-extra></style>
<div class="pg">
	<div class="pg-editor">
		<div class="pg-files" role="tablist" aria-label="Files"></div>
		<div class="pg-code"></div>
		<div class="pg-bar">
			<button type="button" class="btn btn-sm btn-primary" data-run>Run ▶\uFE0E</button>
			<button type="button" class="btn btn-sm" data-reset title="Undo every edit">Reset</button>
			<span class="hint">Ctrl+Enter runs</span>
		</div>
	</div>
	<div class="pg-panel"></div>
</div>`;
			this.syncTheme();
			dark?.addEventListener("change", () => this.syncTheme());
			uiCss.then(
				(css) => {
					root.querySelector("style[data-ui]").textContent = css;
				},
				(error) => console.error("playground: margaui compile failed", error),
			);
			this.fileTabs = root.querySelector(".pg-files");
			this.theme = new Compartment();
			this.extensions = [
				keymap.of([
					{
						key: "Mod-Enter",
						run: () => {
							void this.run();
							return true;
						},
					},
				]),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) this.markCurrentTab();
				}),
				basicSetup,
				javascript(),
				this.theme.of(dark?.matches ? oneDark : []),
			];
			this.view = new EditorView({ parent: root.querySelector(".pg-code"), root });
			root.querySelector("[data-run]").addEventListener("click", () => void this.run());
			root.querySelector("[data-reset]").addEventListener("click", () => void this.reset());

			const rootNode = root.querySelector(".pg-panel");
			rootNode.addEventListener(REQUEST, (e) => this.registry?.mount(e.detail));
			const host = new Host({ document, rootNode });
			this.host = host;
			host.scope.register(playgroundComponents);
			host.scope.registerAskHandlers({
				story: ([key, op, ...args]) => {
					if (this.registry === null) throw new Error("no stories loaded");
					return this.registry.call(key, op, args);
				},
				delay: ([ms]) => new Promise((resolve) => setTimeout(resolve, ms)),
				playground: ([op, id]) => this.onPick(op, id),
			});
			const uiClasses = new ClassCompiler(compile, playgroundClasses());
			uiClasses.watch(rootNode, root.querySelector("style[data-ui-extra]"));
			host.onNotify = (type, info) => {
				if (type === "render") uiClasses.scan(rootNode);
				if (type === "taskFailed" || type === "stateInvalid") console.error(type, info);
			};
			host.start(makePlayground(host.scope.components));
			const src = this.getAttribute("src");
			if (src !== null) void this.load(src, { story: this.getAttribute("story") ?? "" });
		}

		// Shows examples ([{ id, title, src }]) in a selector; load one with loadExample.
		setExamples(examples) {
			this.examples = examples;
			sendRoot(this.host, "setExamples", [examples.map(({ id, title }) => ({ id, title }))]);
		}

		loadExample(id, story = "") {
			const example = this.examples.find((e) => e.id === id) ?? this.examples[0];
			if (example !== undefined) return this.load(example.src, { example: example.id, story });
		}

		syncTheme() {
			const theme = dark?.matches ? "dark" : "light";
			if (this.getAttribute("data-theme") !== theme) this.setAttribute("data-theme", theme);
			this.view?.dispatch({ effects: this.theme.reconfigure(dark?.matches ? oneDark : []) });
		}

		// Loads the files of the module at src and runs it, showing story when it has one.
		async load(src, { example = "", story = "" } = {}) {
			sendRoot(this.host, "loading", [example]);
			this.example = example;
			this.wantedStory = story;
			try {
				const entry = new URL(src, window.document.baseURI).href;
				this.files = await loadSources(entry, {
					fetch: window.fetch.bind(window),
					isExternal: isTutucaSource,
				});
			} catch (error) {
				sendRoot(this.host, "failed", [errorText(error)]);
				return;
			}
			await this.reset();
		}

		// Back to the files as loaded, then runs them.
		reset() {
			this.states = new Map(
				this.files.map((file) => [
					file.url,
					EditorState.create({ doc: file.code, extensions: this.extensions }),
				]),
			);
			this.showFile(this.files[0]?.url ?? null);
			return this.run();
		}

		showFile(url) {
			if (this.current !== null && this.states.has(this.current)) {
				this.states.set(this.current, this.view.state);
			}
			this.current = url;
			const state = this.states.get(url);
			if (state !== undefined) {
				this.view.setState(state);
				this.view.dispatch({ effects: this.theme.reconfigure(dark?.matches ? oneDark : []) });
			}
			this.renderFileTabs();
		}

		tabText(file) {
			return this.isEdited(file) ? `${file.name} •` : file.name;
		}

		markCurrentTab() {
			const i = this.files.findIndex((file) => file.url === this.current);
			const tab = this.fileTabs.children[i];
			if (tab !== undefined) tab.textContent = this.tabText(this.files[i]);
		}

		renderFileTabs() {
			const { document } = window;
			this.fileTabs.replaceChildren(
				...this.files.map((file) => {
					const tab = document.createElement("button");
					tab.type = "button";
					tab.role = "tab";
					tab.textContent = this.tabText(file);
					tab.setAttribute("aria-selected", String(file.url === this.current));
					tab.addEventListener("click", () => this.showFile(file.url));
					return tab;
				}),
			);
		}

		codeOf(file) {
			const state = file.url === this.current ? this.view.state : this.states.get(file.url);
			return state?.doc.toString() ?? file.code;
		}

		isEdited(file) {
			return this.codeOf(file) !== file.code;
		}

		// Links and imports the edited files, then shows their books' stories.
		async run() {
			if (this.files.length === 0) return;
			this.renderFileTabs();
			const files = this.files.map((file) => ({ ...file, code: this.codeOf(file) }));
			let linked = null;
			try {
				linked = linkSources(files);
				const mod = await import(linked.entry);
				const books = booksOf(mod);
				if (books.length === 0) {
					throw new Error(
						"the module exports no books: export default stories({ title, components, stories })",
					);
				}
				const specs = books.flatMap((book) => Object.values(book.components));
				const known = classNamesOf(specs);
				const css = await compile(known);
				this.runs += 1;
				this.registry = new StoryRegistry({
					fc,
					books,
					css,
					compile,
					known,
					prefix: `r${this.runs}/`,
				});
				this.linked?.revoke();
				this.linked = linked;
				const stories = storyChoices(books);
				const wanted = stories.some((s) => s.id === this.wantedStory) ? this.wantedStory : "";
				this.wantedStory = "";
				sendRoot(this.host, "loaded", [stories, this.runs, wanted]);
			} catch (error) {
				linked?.revoke();
				sendRoot(this.host, "failed", [errorText(error)]);
			}
		}

		// The Playground's picks: an example to load, or a story shown.
		onPick(op, id) {
			if (op === "example") void this.loadExample(id);
			this.dispatchEvent(
				new window.CustomEvent("playgroundchange", {
					bubbles: true,
					detail:
						op === "example" ? { example: id, story: "" } : { example: this.example, story: id },
				}),
			);
		}
	}
	window.customElements.define(tagName, TutucaPlayground);
	return TutucaPlayground;
};
