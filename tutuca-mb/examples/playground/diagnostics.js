// moonc's human diagnostics, read back into spans of the files they name:
//   ./typos.mbt:10:39-10:45 [E4091] The type Greeting has no field nmae.
// Lines and columns are 1-based and the end column is exclusive. No dependencies, so the node
// smoke script tests it as the editor uses it.

const DIAGNOSTIC = /^\.?\/?([^\s:]+):(\d+):(\d+)-(\d+):(\d+)\s+(?:\[(\w+)\]\s*)?([\s\S]*)$/;

// One diagnostic as { file, line, col, endLine, endCol, code, severity, message }, or null
// when it names no position.
export const parseDiagnostic = (text) => {
	const m = DIAGNOSTIC.exec(String(text).trim());
	if (m === null) return null;
	const [, file, line, col, endLine, endCol, code = "", rest] = m;
	const warning = /^Warning\b/.test(rest) || /^W/.test(code);
	return {
		file,
		line: Number(line),
		col: Number(col),
		endLine: Number(endLine),
		endCol: Number(endCol),
		code,
		severity: warning ? "warning" : "error",
		message: rest
			.replace(/^Warning\s*/, "")
			.replace(/[ \t]*\n[ \t]*/g, "\n")
			.trim(),
	};
};

// The diagnostics by file name, and the ones no file of `names` has (the boot file's, or a
// message without a position), as text.
export const groupDiagnostics = (raw, names) => {
	const byFile = new Map(names.map((name) => [name, []]));
	const other = [];
	for (const text of raw ?? []) {
		const d = parseDiagnostic(text);
		if (d !== null && byFile.has(d.file)) byFile.get(d.file).push(d);
		else other.push(String(text).trim());
	}
	return { byFile, other };
};

// Character offsets in `code` for a diagnostic, clamped, never empty when the text has a
// character to underline.
export const spanOf = (code, d) => {
	const starts = [0];
	for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
	const at = (line, col) => {
		const l = Math.min(Math.max(line, 1), starts.length) - 1;
		const end = l + 1 < starts.length ? starts[l + 1] - 1 : code.length;
		return Math.min(starts[l] + Math.max(col - 1, 0), end);
	};
	const from = at(d.line, d.col);
	let to = at(d.endLine, d.endCol);
	if (to <= from) to = Math.min(from + 1, code.length);
	return { from, to };
};
