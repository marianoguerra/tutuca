// The custom element studio.tutuca.ts's Editor holds. Its DOM is its own: the
// renderer morphs only the nodes it made, so what it adds inside stays.
//
// tw-code-editor: a component's pure-tutuca module (name.tutuca.ts,
// TypeScript) in CodeMirror (the playground's editor). Its properties say
// what to show: name (the file is name.tutuca.ts), source (its text: set from
// outside, it replaces what's shown; set to what it last said, it's already
// shown), diagnostics (pure-tutuca's, each { file, line, col, endLine, endCol,
// severity, message }), and goto ("12:5"), jumped to whenever jumps changes.
// It fires source-change, a CustomEvent whose detail is the text, as it's
// edited, and run on Ctrl/Cmd-Enter.

import { createEditor } from "../playground/deps/editor.js";

// Defines tw-code-editor in win's registry, once.
export function defineStudioElements(win = globalThis) {
	if (win.customElements.get("tw-code-editor")) return;

	class CodeEditor extends win.HTMLElement {
		#editor = null;
		#name = "";
		#source = "";
		#diagnostics = [];
		#goto = "";
		#jumps = 0;

		connectedCallback() {
			if (this.#editor) return;
			const box = this.ownerDocument.createElement("div");
			box.style.height = "100%";
			this.append(box);
			this.#editor = createEditor(box, {
				onChange: (file) => this.#changed(file),
				onRun: () => this.dispatchEvent(new win.CustomEvent("run", { bubbles: true })),
			});
			this.#open();
		}

		set name(name) {
			if (name === this.#name) return;
			this.#name = name;
			this.#open();
		}
		set source(text) {
			if (text === this.#source) return;
			this.#source = text;
			if (!this.#editor) return;
			this.#editor.open(this.#file(), text, { lang: "ts" });
			this.#showDiagnostics();
		}
		set diagnostics(list) {
			this.#diagnostics = list ?? [];
			this.#showDiagnostics();
		}
		set goto(at) {
			this.#goto = at;
		}
		set jumps(n) {
			if (n === this.#jumps) return;
			this.#jumps = n;
			const [line, col] = this.#goto.split(":");
			this.#editor?.goto(this.#file(), Number(line), Number(col));
		}

		#file() {
			return `${this.#name}.tutuca.ts`;
		}
		// The file afresh, under the name.
		#open() {
			const editor = this.#editor;
			if (!editor) return;
			for (const name of editor.names()) editor.remove(name);
			editor.open(this.#file(), this.#source, { lang: "ts" });
			editor.show(this.#file());
			this.#showDiagnostics();
		}
		#changed(file) {
			const text = this.#editor.text(file);
			this.#source = text;
			this.dispatchEvent(new win.CustomEvent("source-change", { detail: text, bubbles: true }));
		}
		#showDiagnostics() {
			const byFile = {};
			for (const d of this.#diagnostics) {
				byFile[d.file] ??= [];
				byFile[d.file].push({
					line: d.line,
					col: d.col,
					endLine: d.endLine,
					endCol: d.endCol,
					severity: d.severity === "note" ? "info" : d.severity,
					message: d.message,
				});
			}
			this.#editor?.setDiagnostics(byFile);
		}
	}

	win.customElements.define("tw-code-editor", CodeEditor);
}
