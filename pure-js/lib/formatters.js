// Diagnostics as text for people: the code, the message, where (line and column), the line of
// source with the span underlined, and the help, when there is one.

import { lineColumn } from "./diagnostic.js";

const label = (d) => {
	if (d.exclusion === "by-design") return "excluded";
	if (d.exclusion === "omitted") return "omitted";
	return "error";
};

export const formatDiagnostic = (d, source, file = null) => {
	const { line, column } = lineColumn(source, d.start);
	const lines = source.split("\n");
	const text = lines[line - 1] ?? "";
	const width = Math.max(1, Math.min(d.end, d.start + text.length - column + 1) - d.start);
	const gutter = String(line).length;
	const pad = " ".repeat(gutter);
	const where = `${file === null ? "" : `${file}, `}line ${line}, column ${column}`;
	const out = [
		`${label(d)}[purejs::${d.code}]: ${d.message}`,
		`${pad} --> ${where}`,
		`${pad} |`,
		`${line} | ${text}`,
		`${pad} | ${" ".repeat(column - 1)}${"^".repeat(width)}`,
	];
	if (d.help) out.push(`${pad} = help: ${d.help}`);
	return out.join("\n");
};

export const formatDiagnostics = (diagnostics, source, file = null) =>
	diagnostics.map((d) => formatDiagnostic(d, source, file)).join("\n\n");
