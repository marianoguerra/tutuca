// The custom elements studio.tcd's Editor holds. Their DOM is their own: the
// renderer morphs only the nodes it made, so what they add inside stays.
//
// tw-code-editor: a component's .tcd and .wax in CodeMirror (the playground's
// editor). Its properties say what to show: name (the files are name.tcd and
// name.wax), tcd and wax (their text: set from outside, they replace what's
// shown; set to what it last said, they're already shown), current ("tcd" or
// "wax"), diagnostics (tcd's, each { file, line, col, end_line, end_col,
// severity, message }), and goto ("wax:12:5"), jumped to whenever jumps
// changes. It fires tcd-change and wax-change, CustomEvents whose detail is
// the file's text, as it's edited, and run on Ctrl/Cmd-Enter.
//
// tw-slot: holds the node the page provided under its name (provideSlot),
// for a part of the page that isn't a component yet.
import { createEditor } from "../playground/deps/editor.js";

const slots = new Map(); // name -> { node, onShow }

// node goes in the tw-slot named so, and onShow() runs each time it's shown.
export const provideSlot = (name, node, { onShow = () => {} } = {}) => slots.set(name, { node, onShow });

// Defines both in win's registry, once.
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

	class Slot extends win.HTMLElement {
		#name = "";
		set name(name) {
			this.#name = name;
			this.#attach();
		}
		connectedCallback() {
			this.#attach();
		}
		#attach() {
			const slot = slots.get(this.#name);
			if (!slot || !this.isConnected) return;
			if (slot.node.parentNode !== this) this.append(slot.node);
			slot.onShow();
		}
	}

	win.customElements.define("tw-code-editor", CodeEditor);
	win.customElements.define("tw-slot", Slot);
}
