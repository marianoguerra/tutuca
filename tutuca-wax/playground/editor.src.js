// The playground's editor: CodeMirror 6 with two small hand-written modes
// (StreamLanguages, no grammar), TCD and Wax, one EditorState per file so
// each keeps its undo history, read-only files for what tcd generates, and
// tcd's diagnostics underlined inline. Its colors are margaui's theme
// variables, so it follows the page's light or dark theme. Bundled with its
// CodeMirror packages into deps/editor.js by scripts/vendor-editor.mjs; the
// page imports the bundle.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentUnit, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

// A StreamLanguage for a C-like syntax with // comments and "strings".
const mode = ({ keywords, types, builtins, attributes = false }) => ({
	token(stream) {
		if (stream.eatSpace()) return null;
		if (stream.match("///")) {
			stream.skipToEnd();
			return "docComment";
		}
		if (stream.match("//")) {
			stream.skipToEnd();
			return "comment";
		}
		if (attributes && stream.match("#[")) {
			stream.skipTo("]") ? stream.next() : stream.skipToEnd();
			return "meta";
		}
		if (stream.peek() === '"') {
			stream.next();
			let escaped = false;
			let ch;
			while ((ch = stream.next()) != null) {
				if (ch === '"' && !escaped) break;
				escaped = !escaped && ch === "\\";
			}
			return "string";
		}
		if (stream.match(/^-?\d+(\.\d+)?/)) return "number";
		if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
			const w = stream.current();
			if (keywords.has(w)) return "keyword";
			if (types.has(w)) return "typeName";
			if (builtins.has(w)) return "variableName.standard";
			if (w === "true" || w === "false" || w === "null") return "atom";
			return stream.peek() === "(" ? "variableName.function" : "variableName";
		}
		stream.next();
		return null;
	},
	languageData: { commentTokens: { line: "//" } },
});

const LANGUAGES = {
	tcd: StreamLanguage.define(
		mode({
			keywords: words(`package use interface component register as field get message notify ask
				invariant init loop scope provide view example for start send expect where when changes
				ensures emits nothing swap source_key and or not in matches ask_handler host_ask prepare
				iter key filter enrich make`),
			types: words("bool s32 f64 string any enum option list map record one_of result index"),
			builtins: words(`field seq_item provided bind if frag render render_each each render_it
				push_view target_value drag_key event el len keys values all any check next it`),
		}),
	),
	wax: StreamLanguage.define(
		mode({
			keywords: words("fn let const type rec if else while loop do br return match import export as mut unreachable open"),
			types: words("i32 i64 f32 f64 eq any extern struct array"),
			builtins: words(""),
			attributes: true,
		}),
	),
	json: StreamLanguage.define(mode({ keywords: words(""), types: words(""), builtins: words("") })),
};

const highlight = HighlightStyle.define([
	{ tag: tags.keyword, color: "var(--color-primary)", fontWeight: "600" },
	{ tag: tags.typeName, color: "var(--color-secondary)" },
	{ tag: [tags.function(tags.variableName), tags.standard(tags.variableName)], color: "var(--color-accent)" },
	{ tag: tags.string, color: "var(--color-success)" },
	{ tag: [tags.number, tags.atom, tags.bool], color: "var(--color-info)" },
	{ tag: tags.comment, color: "color-mix(in oklab, var(--color-base-content) 50%, transparent)", fontStyle: "italic" },
	{ tag: tags.docComment, color: "color-mix(in oklab, var(--color-base-content) 65%, transparent)", fontStyle: "italic" },
	{ tag: tags.meta, color: "var(--color-warning)" },
]);

const theme = EditorView.theme({
	"&": { height: "100%", backgroundColor: "var(--color-base-100)", color: "var(--color-base-content)", fontSize: "13px" },
	".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", caretColor: "var(--color-base-content)" },
	".cm-gutters": {
		backgroundColor: "var(--color-base-200)",
		color: "color-mix(in oklab, var(--color-base-content) 50%, transparent)",
		borderRight: "1px solid var(--color-base-300)",
	},
	".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--color-base-content) 6%, transparent)" },
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
		backgroundColor: "color-mix(in oklab, var(--color-primary) 25%, transparent) !important",
	},
	".cm-cursor": { borderLeftColor: "var(--color-base-content)" },
	".cm-scroller": { overflow: "auto" },
});

// An editor in parent showing one file at a time. onChange(name) after an
// edit; onRun() for Ctrl/Cmd-Enter.
export function createEditor(parent, { onChange = () => {}, onRun = () => {} } = {}) {
	const files = new Map(); // name -> { state, diagnostics }
	let current = null;
	const run = keymap.of([{ key: "Mod-Enter", run: () => (onRun(), true) }]);
	const stateFor = (text, lang, readOnly) =>
		EditorState.create({
			doc: text,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				history(),
				drawSelection(),
				bracketMatching(),
				indentUnit.of("    "),
				run,
				keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
				LANGUAGES[lang] ?? LANGUAGES.json,
				syntaxHighlighting(highlight),
				theme,
				lintGutter(),
				EditorState.readOnly.of(readOnly),
				EditorView.editable.of(!readOnly),
				EditorView.updateListener.of((u) => {
					if (u.docChanged && current !== null) onChange(current);
				}),
			],
		});
	const view = new EditorView({ parent, state: stateFor("", "json", true) });
	// tcd's diagnostics, as CodeMirror's: offsets from 1-based lines and columns.
	const toCm = (doc, list) =>
		list.map((d) => {
			const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
			const from = Math.min(line.from + Math.max(d.col - 1, 0), line.to);
			let to = from;
			if (d.endLine >= 1) {
				const end = doc.line(Math.min(d.endLine, doc.lines));
				to = Math.min(end.from + Math.max(d.endCol - 1, 0), end.to);
			}
			if (to <= from) to = Math.min(from + 1, doc.length);
			return { from, to, severity: d.severity, message: d.message };
		});
	const save = () => {
		if (current !== null) files.get(current).state = view.state;
	};
	const editor = {
		// Adds or replaces a file; lang is tcd, wax or json.
		open(name, text, { lang = "json", readOnly = false } = {}) {
			const existing = files.get(name);
			if (existing && current === name) {
				view.setState(stateFor(text, lang, readOnly));
				files.set(name, { state: view.state, diagnostics: [] });
				return;
			}
			files.set(name, { state: stateFor(text, lang, readOnly), diagnostics: existing?.diagnostics ?? [] });
		},
		has: (name) => files.has(name),
		remove(name) {
			files.delete(name);
			// Not saved back over a file opened under its name later.
			if (current === name) current = null;
		},
		names: () => [...files.keys()],
		current: () => current,
		text(name) {
			if (name === current) return view.state.doc.toString();
			return files.get(name)?.state.doc.toString() ?? "";
		},
		show(name) {
			save();
			const file = files.get(name);
			if (!file) return;
			current = name;
			view.setState(file.state);
			view.dispatch(setDiagnostics(view.state, toCm(view.state.doc, file.diagnostics)));
		},
		// Diagnostics per file: [{ line, col, endLine, endCol, severity, message }].
		setDiagnostics(byFile) {
			for (const [name, file] of files) file.diagnostics = byFile[name] ?? [];
			if (current !== null) {
				view.dispatch(setDiagnostics(view.state, toCm(view.state.doc, files.get(current).diagnostics)));
			}
		},
		goto(name, line, col) {
			editor.show(name);
			const doc = view.state.doc;
			const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
			const pos = Math.min(l.from + Math.max(col - 1, 0), l.to);
			view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
			view.focus();
		},
		focus: () => view.focus(),
	};
	return editor;
}
