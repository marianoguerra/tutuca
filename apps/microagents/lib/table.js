// Tables the agents share: a part of kind "table" (data: an array of row objects) or "csv"
// (data: CSV text; meta https://tutuca.dev/d/csv: delimiter, header), read into rows with the
// helpers in components/data-views/table.js and written back the way they came.
import { isObject } from "../../../components/data-views/json.js";
import { formatCsv, parseCsv } from "../../../components/data-views/table.js";
import { fromJson, message, toJson } from "../core/tdata.js";

export * from "../../../components/data-views/table.js";

export const CSV = "https://tutuca.dev/d/csv";
export const KINDS = ["table", "csv"];

// A csv part's options: { delimiter, header }.
export const csvOptions = (m) => {
	const h = m.meta?.get(CSV);
	const delimiter = typeof h?.get("delimiter") === "string" ? h.get("delimiter") : ",";
	return { delimiter, header: h?.get("header") !== false };
};
// A table or csv part as { id, kind, rows, delimiter }.
export const readPart = (m) => {
	const { delimiter, header } = csvOptions(m);
	if (m.kind === "csv")
		return {
			id: m.id,
			kind: "csv",
			rows: typeof m.data === "string" ? parseCsv(m.data, delimiter, header) : [],
			delimiter,
		};
	let rows = [];
	try {
		rows = Array.isArray(m.data) ? toJson(m.data).filter(isObject) : [];
	} catch {}
	return { id: m.id, kind: "table", rows, delimiter };
};
// The part for table x ({ id, kind, rows, delimiter }): m with x's rows, in m's form, or a new
// table part when there's no m.
export const writePart = (m, x) => {
	if (m === undefined || m === null) return message(x.id, "table", fromJson(x.rows));
	return m.kind === "csv"
		? { ...m, data: formatCsv(x.rows, x.delimiter) }
		: { ...m, data: fromJson(x.rows) };
};
