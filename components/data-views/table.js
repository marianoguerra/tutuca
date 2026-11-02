// Tables as rows of plain objects: CSV text parsed into them and written back, each column's
// name and type, a description of each column and rows ready to show.

export const PREVIEW_ROWS = 8;

// A CSV cell's text as a value: numbers, booleans, null for empty, text otherwise.
export const autoType = (s) => {
	const v = s.trim();
	if (v === "") return null;
	if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return Number(v);
	if (v === "true" || v === "false") return v === "true";
	return s;
};
// CSV text as row objects; without a header the columns are c1, c2, …
export const parseCsv = (text, delimiter = ",", header = true) => {
	const records = [];
	let row = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c !== '"') cell += c;
			else if (text[i + 1] === '"') cell += text[i++];
			else quoted = false;
		} else if (c === '"' && cell === "") quoted = true;
		else if (c === delimiter) {
			row.push(cell);
			cell = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			records.push([...row, cell]);
			row = [];
			cell = "";
		} else cell += c;
	}
	if (cell !== "" || row.length > 0) records.push([...row, cell]);
	const lines = records.filter((r) => !(r.length === 1 && r[0].trim() === ""));
	const names = header ? (lines[0] ?? []) : (lines[0] ?? []).map((_, j) => `c${j + 1}`);
	return (header ? lines.slice(1) : lines).map((r) =>
		Object.fromEntries(names.map((n, j) => [n, autoType(r[j] ?? "")])),
	);
};
// Row objects as CSV text, with a header of every column in the order they first appear.
export const formatCsv = (rows, delimiter = ",") => {
	const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
	const cell = (v) => {
		const s = v === null || v === undefined ? "" : String(v);
		return /["\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replaceAll('"', '""')}"` : s;
	};
	return [names, ...rows.map((r) => names.map((n) => r[n]))]
		.map((r) => r.map(cell).join(delimiter))
		.join("\n");
};
// A value's column type: integer, number, date (ISO-looking text), string, boolean, object.
export const cellType = (v) => {
	if (v === null || v === undefined) return null;
	if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
	if (typeof v === "string")
		return /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/.test(v) ? "date" : "string";
	return typeof v === "boolean" ? "boolean" : "object";
};
// [{ name, type }] in the order columns first appear; "mixed" or "empty" when no one type fits.
export const columnsOf = (rows) => {
	const types = new Map();
	for (const row of rows) {
		for (const [k, v] of Object.entries(row)) {
			if (!types.has(k)) types.set(k, new Set());
			if (cellType(v) !== null) types.get(k).add(cellType(v));
		}
	}
	return [...types].map(([name, set]) => {
		const ts = [...set];
		if (set.size === 2 && set.has("integer") && set.has("number")) return { name, type: "number" };
		return { name, type: ts.length === 0 ? "empty" : ts.length === 1 ? ts[0] : "mixed" };
	});
};
// A table ({ id, kind, rows }) per column: type, min, max, distinct and null counts, plus 3
// sample rows.
export const describe = (x) => ({
	id: x.id,
	kind: x.kind,
	rows: x.rows.length,
	columns: columnsOf(x.rows).map(({ name, type }) => {
		const values = x.rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
		const keys = values.map((v) => (typeof v === "object" ? JSON.stringify(v) : v));
		const sorted =
			type === "integer" || type === "number"
				? [...values].sort((a, b) => a - b)
				: keys.map(String).sort();
		return {
			name,
			type,
			min: sorted[0] ?? null,
			max: sorted.at(-1) ?? null,
			distinct: new Set(keys).size,
			nulls: x.rows.length - values.length,
		};
	}),
	sample: x.rows.slice(0, 3),
});

// Rows as preview rows for a view: [{ cells: [{ text }] }], the first n.
export const previewRows = (rows, columns = columnsOf(rows), n = PREVIEW_ROWS) =>
	rows.slice(0, n).map((r) => ({
		cells: columns.map(({ name }) => ({
			text: r[name] === null || r[name] === undefined ? "" : String(r[name]),
		})),
	}));
