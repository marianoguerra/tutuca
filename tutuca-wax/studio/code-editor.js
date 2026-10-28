// The custom element studio.tcd's Editor holds. Its DOM is its own: the
// renderer morphs only the nodes it made, so what it adds inside stays.
//
// tw-code-editor: a component's .tcd and .wax in CodeMirror (the playground's
// editor). Its properties say what to show: name (the files are name.tcd and
// name.wax), tcd and wax (their text: set from outside, they replace what's
// shown; set to what it last said, they're already shown), current ("tcd" or
// "wax"), diagnostics (tcd's, each { file, line, col, end_line, end_col,
// severity, message }), and goto ("wax:12:5"), jumped to whenever jumps
// changes. It fires tcd-change and wax-change, CustomEvents whose detail is
// the file's text, as it's edited, and run on Ctrl/Cmd-Enter.

import { createEditor } from "../playground/deps/editor.js";

// Defines tw-code-editor in win's registry, once.
export function defineStudioElements(win = globalThis) {
	if (win.customElements.get("tw-code-editor")) return;

	class CodeEditor extends win.HTMLElement {
		#editor = null;
		#name = "";
		#texts = { tcd: "", wax: "" };
		#current = "tcd";
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
		set tcd(text) {
			this.#setText("tcd", text);
		}
		set wax(text) {
			this.#setText("wax", text);
		}
		set current(kind) {
			if (kind === this.#current) return;
			this.#current = kind;
			this.#editor?.show(this.#file(kind));
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
			const [kind, line, col] = this.#goto.split(":");
			this.#current = kind;
			this.#editor?.goto(this.#file(kind), Number(line), Number(col));
		}

		#file(kind) {
			return `${this.#name}.${kind}`;
		}
		// Both files afresh, under the name.
		#open() {
			const editor = this.#editor;
			if (!editor) return;
			for (const name of editor.names()) editor.remove(name);
			for (const kind of ["tcd", "wax"]) editor.open(this.#file(kind), this.#texts[kind], { lang: kind });
			editor.show(this.#file(this.#current));
			this.#showDiagnostics();
		}
		#setText(kind, text) {
			if (text === this.#texts[kind]) return;
			this.#texts[kind] = text;
			if (!this.#editor) return;
			this.#editor.open(this.#file(kind), text, { lang: kind });
			this.#showDiagnostics();
		}
		#changed(file) {
			const kind = file.endsWith(".wax") ? "wax" : "tcd";
			const text = this.#editor.text(file);
			this.#texts[kind] = text;
			this.dispatchEvent(new win.CustomEvent(`${kind}-change`, { detail: text, bubbles: true }));
		}
		#showDiagnostics() {
			const byFile = {};
			for (const d of this.#diagnostics) {
				(byFile[d.file] ??= []).push({
					line: d.line,
					col: d.col,
					endLine: d.end_line,
					endCol: d.end_col,
					severity: d.severity === "note" ? "info" : d.severity,
					message: d.message,
				});
			}
			this.#editor?.setDiagnostics(byFile);
		}
	}

	win.customElements.define("tw-code-editor", CodeEditor);
}
