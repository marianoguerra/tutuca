// The playground's editor: CodeMirror 6 with a small hand-written MoonBit mode (a
// StreamLanguage: no grammar, no onig.wasm), light and dark palettes that follow the OS, one
// EditorState per file so each keeps its undo history, and compiler diagnostics underlined
// inline. Bundled with its CodeMirror packages into deps/editor.js by
// scripts/vendor-codemirror.mjs; the page imports the bundle.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
	bracketMatching,
	HighlightStyle,
	indentOnInput,
	indentUnit,
	StreamLanguage,
	syntaxHighlighting,
} from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { spanOf } from "./diagnostics.js";

const KEYWORDS = new Set(
	(
		"fn let mut type typealias struct enum trait impl derive pub priv readonly extern const " +
		"if else while for in match loop return break continue raise try catch guard as is with " +
		"and test self using fnalias async defer noraise suberror extend"
	).split(" "),
);

const tokenString = (stream, state) => {
	let escaped = false;
	let ch;
	while ((ch = stream.next()) != null) {
		if (ch === '"' && !escaped) break;
		escaped = !escaped && ch === "\\";
	}
	state.tokenize = null;
	return "string";
};

const baseToken = (stream, state) => {
	if (stream.eatSpace()) return null;
	if (stream.match(/^[#$]\|.*/)) return "string"; // #| and $| multiline strings
	if (stream.match(/^\/\/.*/)) return "comment";
	const ch = stream.peek();
	if (ch === "'" && stream.match(/^'(?:\\.|[^'\\])'/)) return "string";
	if (ch === '"') {
		stream.next();
		state.tokenize = tokenString;
		return tokenString(stream, state);
	}
	if (
		stream.match(/^0[xX][0-9a-fA-F_]+/) ||
		stream.match(/^0[oObB][0-7_]+/) ||
		stream.match(/^\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[a-zA-Z]*/)
	)
		return "number";
	if (stream.match(/^@[A-Za-z_][A-Za-z0-9_]*/)) return "namespace";
	const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
	if (word) {
		const w = word[0];
		if (w === "true" || w === "false") return "bool";
		if (KEYWORDS.has(w)) return "keyword";
		return /^[A-Z]/.test(w) ? "typeName" : "variableName";
	}
	if (stream.match(/^[+\-*/%=<>!&|^~?:.]+/)) return "operator";
	stream.next();
	return null;
};

export const moonbitMode = StreamLanguage.define({
	name: "moonbit",
	startState: () => ({ tokenize: null }),
	token: (stream, state) => (state.tokenize ?? baseToken)(stream, state),
	languageData: { commentTokens: { line: "//" } },
});

const palette = (c) =>
	HighlightStyle.define([
		{ tag: tags.comment, color: c.comment, fontStyle: "italic" },
		{ tag: tags.keyword, color: c.keyword },
		{ tag: [tags.bool, tags.number, tags.operator], color: c.number },
		{ tag: tags.string, color: c.string },
		{ tag: tags.typeName, color: c.type },
		{ tag: tags.namespace, color: c.namespace },
	]);
const light = palette({
	comment: "#6e7781",
	keyword: "#cf222e",
	number: "#0550ae",
	string: "#0a3069",
	type: "#953800",
	namespace: "#6639ba",
});
const dark = palette({
	comment: "#8b949e",
	keyword: "#ff7b72",
	number: "#79c0ff",
	string: "#a5d6ff",
	type: "#ffa657",
	namespace: "#d2a8ff",
});
const base = (isDark) =>
	EditorView.theme(
		{
			"&": { height: "100%", fontSize: "13px", backgroundColor: "transparent" },
			"&.cm-focused": { outline: "none" },
			".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
			".cm-gutters": { backgroundColor: "transparent", border: "none" },
			".cm-cursor": { borderLeftColor: isDark ? "#c9d1d9" : "#24292f" },
			".cm-activeLine": {
				backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
			},
		},
		{ dark: isDark },
	);
const themed = (isDark) => [base(isDark), syntaxHighlighting(isDark ? dark : light)];

// createEditor({ parent, root?, onRun?, onChange? }): an editor over named files.
//   open(name) shows a file; load(files) replaces them ([[name, code]]), showing the first;
//   value(name) reads one; setDiagnostics(name, [diagnostic]) underlines a file's
//   (diagnostics.js parseDiagnostic shapes); clearDiagnostics() clears every file's.
export const createEditor = ({ parent, root, onRun, onChange }) => {
	const theme = new Compartment();
	const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
	const isDark = () => media?.matches ?? false;
	const extensions = [
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightActiveLine(),
		history(),
		drawSelection(),
		indentUnit.of("  "),
		indentOnInput(),
		bracketMatching(),
		lintGutter(),
		moonbitMode,
		theme.of(themed(isDark())),
		keymap.of([
			{ key: "Mod-Enter", preventDefault: true, run: () => (onRun?.(), true) },
			indentWithTab,
			...defaultKeymap,
			...historyKeymap,
		]),
		EditorView.updateListener.of((u) => {
			if (u.docChanged) onChange?.(current);
		}),
	];
	const view = new EditorView({ parent, root });
	const states = new Map();
	const pending = new Map(); // name → diagnostics for a file not showing
	let current = null;
	const show = (name) => {
		if (current !== null) states.set(current, view.state);
		current = name;
		view.setState(states.get(name));
		view.dispatch({ effects: theme.reconfigure(themed(isDark())) });
		apply(name, pending.get(name) ?? []);
	};
	const apply = (name, list) => {
		pending.set(name, list);
		if (name !== current) return;
		const code = view.state.doc.toString();
		const marks = list
			.map((d) => ({ ...spanOf(code, d), severity: d.severity, message: d.message }))
			.sort((a, b) => a.from - b.from || a.to - b.to);
		view.dispatch(setDiagnostics(view.state, marks));
	};
	media?.addEventListener?.("change", () =>
		view.dispatch({ effects: theme.reconfigure(themed(isDark())) }),
	);
	return {
		view,
		load(files) {
			states.clear();
			pending.clear();
			current = null;
			for (const [name, code] of files) states.set(name, EditorState.create({ doc: code, extensions }));
			if (files.length > 0) show(files[0][0]);
		},
		open: show,
		current: () => current,
		value: (name) =>
			name === current ? view.state.doc.toString() : states.get(name)?.doc.toString() ?? "",
		setDiagnostics: apply,
		clearDiagnostics() {
			for (const name of states.keys()) apply(name, []);
		},
		focus: () => view.focus(),
	};
};
