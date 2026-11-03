// Host functions for vega-lite-lab: Vega-Lite specs checked against tables.
// A table is { id, rows } (an array of row objects) or { id, csv,
// delimiter? } (CSV text); the spec reads one with {"data": {"name": id}}.
//
//   vega_tables(tables)                 [{ id, kind, count, columns: [{ name, type }], rows }]
//   vega_describe(tables)               per table: rows, each column's type, min, max, distinct and nulls, 3 sample rows
//   vega_check(spec, tables)            { ok, errors, warnings, marks }: the spec compiled by Vega-Lite
//   vega_chart_spec(spec, tables)       the spec as JSON text with each named table's rows inlined as data.values
//   vega_patch(doc, pointer, value)     doc with value at pointer; throws why it can't
//   vega_remove(doc, pointer)           doc without what pointer names; throws why it can't
//   vega_format_csv(rows, delimiter)    rows as CSV text
//
// Compiling is synchronous; drawing isn't, so the page's <ma-vega> element
// draws chart_spec (microagents/elements.js). The helpers below are shared
// with echarts.js.
export const bundle = "vega";

// ---- JSON --------------------------------------------------------------------------

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// "object" or "array" when v is a string holding JSON text for one, else "".
const jsonTextKind = (v) => {
	if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return "";
	try {
		const value = JSON.parse(v);
		return Array.isArray(value) ? "array" : isObject(value) ? "object" : "";
	} catch {
		return "";
	}
};

const escapeToken = (key) => String(key).replace(/~/g, "~0").replace(/\//g, "~1");
const format = (tokens) => tokens.map((t) => `/${escapeToken(t)}`).join("");
const INDEX = /^(0|[1-9]\d*)$/;

const parsePointer = (pointer) => {
	if (pointer === "") return { tokens: [] };
	if (!pointer.startsWith("/")) return { error: `a pointer starts with /, ${JSON.stringify(pointer)} doesn't` };
	const tokens = [];
	for (const [i, raw] of pointer.slice(1).split("/").entries()) {
		if (/~([^01]|$)/.test(raw)) return { error: `segment ${i + 1} ("${raw}") has a ~ that isn't ~0 (for ~) or ~1 (for /)` };
		tokens.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
	}
	return { tokens };
};

// doc changed at pointer by change(parent, key) on a copy; throws why it
// can't. The parent must exist: a pointer doesn't make the objects on its way.
const changeAt = (doc, pointer, change, removing) => {
	const { tokens, error } = parsePointer(pointer);
	if (error) throw new Error(error);
	const root = structuredClone(doc);
	let at = root;
	const nothingInside = (where, v) => `${where} is a ${typeOf(v)}, not an object or an array: there is nothing inside it to ${removing ? "remove" : "set"}`;
	for (const [i, token] of tokens.slice(0, -1).entries()) {
		const where = format(tokens.slice(0, i)) || "the document";
		const missing = format(tokens.slice(0, i + 1));
		const inside = JSON.stringify(tokens.slice(i + 1).join("/"));
		if (Array.isArray(at)) {
			if (!INDEX.test(token) || Number(token) >= at.length) {
				const n = at.length;
				throw new Error(`${where} is an array of ${n} item${n === 1 ? "" : "s"}, with no item ${JSON.stringify(token)}${removing ? ": there is nothing to remove" : ` to set ${inside} inside`}`);
			}
			at = at[Number(token)];
		} else if (isObject(at)) {
			if (!Object.hasOwn(at, token)) {
				throw new Error(
					removing
						? `${where} has no key ${JSON.stringify(token)}: there is nothing to remove`
						: `${where} has no key ${JSON.stringify(token)}, and a pointer doesn't make the objects on its way: set ${missing} to the whole object (or array) holding ${inside} instead`,
				);
			}
			at = at[token];
		} else throw new Error(nothingInside(where, at));
	}
	if (at === null || typeof at !== "object") throw new Error(nothingInside(format(tokens.slice(0, -1)) || "the document", at));
	const failed = change(at, tokens.at(-1));
	if (failed) throw new Error(failed);
	return root;
};

// doc with value at pointer ("/-" appends to an array); a value that is JSON
// text for an object or an array is refused.
export const patchAt = (doc, pointer, value) => {
	const kind = jsonTextKind(value);
	if (kind !== "") throw new Error(`the value is a string holding JSON text for an ${kind}: send the ${kind} itself, not encoded as a string`);
	if (pointer === "") throw new Error("the empty pointer is the whole document: replace it whole instead");
	return changeAt(doc, pointer, (parent, key) => {
		if (Array.isArray(parent)) {
			const n = key === "-" ? parent.length : INDEX.test(key) ? Number(key) : -1;
			if (n < 0 || n > parent.length) return `${JSON.stringify(key)} isn't an index of the array (it has ${parent.length} items)`;
			parent[n] = value;
		} else parent[key] = value;
		return "";
	});
};

// doc without what pointer names.
export const removeAt = (doc, pointer) => {
	if (pointer === "") throw new Error("the empty pointer is the whole document");
	return changeAt(
		doc,
		pointer,
		(parent, key) => {
			if (!Object.hasOwn(parent, key) || (Array.isArray(parent) && !INDEX.test(key))) return `there is no ${JSON.stringify(key)} to remove`;
			if (Array.isArray(parent)) parent.splice(Number(key), 1);
			else delete parent[key];
			return "";
		},
		true,
	);
};

// ---- Tables ------------------------------------------------------------------------

// A CSV cell's text as a value: numbers, booleans, null for empty, text otherwise.
const autoType = (s) => {
	const v = s.trim();
	if (v === "") return null;
	if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return Number(v);
	if (v === "true" || v === "false") return v === "true";
	return s;
};

// CSV text (with a header row) as row objects.
export const parseCsv = (text, delimiter = ",") => {
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
	const names = lines[0] ?? [];
	return lines.slice(1).map((r) => Object.fromEntries(names.map((n, j) => [n, autoType(r[j] ?? "")])));
};

// Row objects as CSV text, with a header of every column in the order they first appear.
export const formatCsv = (rows, delimiter = ",") => {
	const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
	const cell = (v) => {
		const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
		return /["\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replaceAll('"', '""')}"` : s;
	};
	return `${[names, ...rows.map((r) => names.map((n) => r[n]))].map((r) => r.map(cell).join(delimiter)).join("\n")}\n`;
};

// A value's column type: integer, number, date (ISO-looking text), string, boolean, object.
const cellType = (v) => {
	if (v === null || v === undefined) return null;
	if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
	if (typeof v === "string") return /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/.test(v) ? "date" : "string";
	return typeof v === "boolean" ? "boolean" : "object";
};

// [{ name, type }] in the order columns first appear; "mixed" or "empty" when no one type fits.
export const columnsOf = (rows) => {
	const types = new Map();
	for (const row of rows) {
		if (!isObject(row)) continue;
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

const csvRows = new Map();
// A table's rows: its rows, or its CSV parsed (kept by text).
const rowsOf = (t) => {
	if (!isObject(t)) return [];
	if (typeof t.csv === "string") {
		const delimiter = typeof t.delimiter === "string" && t.delimiter !== "" ? t.delimiter : ",";
		const key = `${delimiter}\u0000${t.csv}`;
		if (!csvRows.has(key)) {
			if (csvRows.size > 64) csvRows.clear();
			csvRows.set(key, parseCsv(t.csv, delimiter));
		}
		return csvRows.get(key);
	}
	return Array.isArray(t.rows) ? t.rows.filter(isObject) : [];
};

// The tables as { id, kind, count, columns, rows }.
export const readTables = (tables) =>
	(Array.isArray(tables) ? tables : []).filter(isObject).map((t) => {
		const rows = rowsOf(t);
		return { id: String(t.id ?? ""), kind: typeof t.csv === "string" ? "csv" : "table", count: rows.length, columns: columnsOf(rows), rows };
	});

// A table per column: type, min, max, distinct and null counts, plus 3 sample rows.
export const describe = (x) => ({
	id: x.id,
	kind: x.kind,
	rows: x.rows.length,
	columns: x.columns.map(({ name, type }) => {
		const values = x.rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
		const keys = values.map((v) => (typeof v === "object" ? JSON.stringify(v) : v));
		const sorted = type === "integer" || type === "number" ? [...values].sort((a, b) => a - b) : keys.map(String).sort();
		return { name, type, min: sorted[0] ?? null, max: sorted.at(-1) ?? null, distinct: new Set(keys).size, nulls: x.rows.length - values.length };
	}),
	sample: x.rows.slice(0, 3),
});

// fn(...args) kept by the args' JSON text, the last size of them.
export const cached = (fn, size = 64) => {
	const cache = new Map();
	return (...args) => {
		const key = JSON.stringify(args);
		if (cache.has(key)) return cache.get(key);
		if (cache.size >= size) cache.delete(cache.keys().next().value);
		const value = fn(...args);
		cache.set(key, value);
		return value;
	};
};

// Calls visit(key, value) on every key of every object in v.
export const walk = (v, visit) => {
	if (Array.isArray(v)) for (const x of v) walk(x, visit);
	else if (isObject(v)) {
		for (const [k, x] of Object.entries(v)) {
			visit(k, x);
			walk(x, visit);
		}
	}
};

// ---- Vega-Lite ---------------------------------------------------------------------

const MARKS = ["arc", "area", "bar", "boxplot", "circle", "errorband", "errorbar", "geoshape", "image", "line", "point", "rect", "rule", "square", "text", "tick", "trail"];

// A copy of spec where every {"data": {"name": id}} naming a table has its
// rows inlined as values.
const inlined = (spec, tables) => {
	const byId = new Map(tables.map((x) => [x.id, x.rows]));
	const visit = (v) => {
		if (Array.isArray(v)) return v.map(visit);
		if (!isObject(v)) return v;
		const out = {};
		for (const [k, x] of Object.entries(v)) {
			out[k] = k === "data" && isObject(x) && typeof x.name === "string" && byId.has(x.name) && x.values === undefined ? { ...x, values: byId.get(x.name).map((r) => ({ ...r })) } : visit(x);
		}
		return out;
	};
	return visit(spec);
};

// What's wrong with spec before Vega-Lite sees it: unknown marks and table
// names are errors, fields no table has are warnings.
const precheck = (spec, tables, errors, warnings) => {
	const names = new Set([...tables.map((x) => x.id), ...Object.keys(isObject(spec.datasets) ? spec.datasets : {})]);
	const known = new Set(tables.flatMap((x) => x.columns.map((c) => c.name)));
	const knowRows = (rows) => {
		if (Array.isArray(rows)) for (const c of columnsOf(rows)) known.add(c.name);
	};
	Object.values(isObject(spec.datasets) ? spec.datasets : {}).forEach(knowRows);
	const fields = new Set();
	walk(spec, (k, v) => {
		if (k === "mark") {
			const type = isObject(v) ? v.type : v;
			if (!MARKS.includes(type)) errors.push(`unknown mark ${JSON.stringify(type)}; marks are ${MARKS.join(", ")}`);
		} else if (k === "data" && isObject(v)) {
			if (typeof v.name === "string" && !names.has(v.name)) errors.push(`data name "${v.name}" isn't a table; the tables are ${[...names].join(", ") || "none"}`);
			knowRows(v.values);
		} else if (k === "as") {
			for (const a of [v].flat()) if (typeof a === "string") known.add(a);
		} else if (k === "fold") {
			known.add("key");
			known.add("value");
		} else if (k === "encoding" && isObject(v)) {
			walk(v, (k2, v2) => {
				if (k2 === "field" && typeof v2 === "string") fields.add(v2);
			});
		}
	});
	for (const f of fields) {
		if (!known.has(f.split(".")[0])) warnings.push(`field "${f}" isn't a column of any table (columns: ${[...known].join(", ") || "none"})`);
	}
};

// A Vega logger whose warnings and errors go to the lists.
const loggerFor = (errors, warnings) => ({
	level(l) {
		return l === undefined ? 2 : this;
	},
	error(...a) {
		errors.push(a.join(" "));
		return this;
	},
	warn(...a) {
		warnings.push(a.join(" "));
		return this;
	},
	info() {
		return this;
	},
	debug() {
		return this;
	},
});

export const make = ({ vega, compile }) => {
	const check = cached((spec, raw) => {
		const errors = [];
		const warnings = [];
		const out = (marks = []) => ({ ok: errors.length === 0, errors, warnings, marks });
		if (!isObject(spec)) {
			errors.push("the spec must be a JSON object");
			return out();
		}
		const tables = readTables(raw);
		precheck(spec, tables, errors, warnings);
		if (errors.length > 0) return out();
		try {
			const compiled = compile(inlined(spec, tables), { logger: loggerFor(errors, warnings) }).spec;
			vega.parse(compiled);
			return out((compiled.marks ?? []).map((m) => m.type));
		} catch (e) {
			errors.push(`Vega-Lite can't compile the spec: ${e.message}`);
			return out();
		}
	});
	return {
		vega_tables: cached((tables) => readTables(tables), 16),
		vega_describe: (tables) => readTables(tables).map(describe),
		vega_check: check,
		vega_chart_spec: cached((spec, tables) => (check(spec, tables).ok ? JSON.stringify(inlined(spec, readTables(tables))) : ""), 16),
		vega_patch: patchAt,
		vega_remove: removeAt,
		vega_format_csv: (rows, delimiter) => formatCsv(Array.isArray(rows) ? rows.filter(isObject) : [], delimiter || ","),
	};
};
