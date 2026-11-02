// Expectations: what a part should give, kept in its meta under the dialect
// https://tutuca.dev/d/expect as Scalar headers ({ outcome: "pass" }, { r1: "match" }, …), and
// the statuses and badges for checking them.
import { headers } from "../core/tdata.js";

export const DIALECT = "https://tutuca.dev/d/expect";
export const OUTCOMES = ["match", "no-match"];

// The part's expectations as a plain object; accept keeps only those values (a list of them,
// or "string" for any string).
export const read = (m, { accept } = {}) => {
	let h;
	try {
		h = headers(m, DIALECT);
	} catch {
		return {};
	}
	if (accept === undefined) return h;
	const ok = accept === "string" ? (v) => typeof v === "string" : (v) => accept.includes(v);
	return Object.fromEntries(Object.entries(h).filter(([, v]) => ok(v)));
};
// One expectation, or fallback.
export const get = (m, key, fallback = null) => read(m)[key] ?? fallback;
export const same = (a, b) =>
	JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// meta with the dialect's headers set to obj; an empty obj removes the dialect.
export const withAll = (meta, obj, dialect = DIALECT) => {
	const out = new Map(meta ?? []);
	if (Object.keys(obj).length === 0) out.delete(dialect);
	else out.set(dialect, new Map(Object.entries(obj)));
	return out;
};
// meta with one header of dialect set; null, undefined or "" removes it (and the dialect when
// it's left empty).
export const withHeader = (meta, dialect, key, value) => {
	const out = new Map(meta ?? []);
	const h = new Map(out.get(dialect) ?? []);
	if (value === null || value === undefined || value === "") h.delete(key);
	else h.set(key, value);
	if (h.size === 0) out.delete(dialect);
	else out.set(dialect, h);
	return out;
};
// The meta of a new part with expectations obj.
export const metaFor = (obj) => withAll(new Map(), obj);

// Clicking an expectation moves it on: none → match → no-match → none.
export const CYCLE = { none: "match", match: "no-match", "no-match": "none" };
// expect with key moved on by CYCLE (a new object).
export const cycle = (expect, key) => {
	const next = CYCLE[expect[key] ?? "none"];
	const out = { ...expect };
	if (next === "none") delete out[key];
	else out[key] = next;
	return out;
};
// pass, fail or none for an expectation ("match"/"no-match"/"pass"/"fail"/undefined) and
// whether it matched (true/false), invalid when it couldn't be checked (null).
export const status = (expected, matched) => {
	if (matched === null || matched === undefined) return "invalid";
	if (expected === undefined || expected === null || expected === "none") return "none";
	const wanted = expected === "match" || expected === "pass" || expected === true;
	return wanted === matched ? "pass" : "fail";
};
// The badge classes per status.
export const BADGE = {
	pass: "badge badge-success",
	fail: "badge badge-error",
	none: "badge badge-ghost",
	invalid: "badge badge-warning",
	error: "badge badge-warning",
};
// "3 pass · 1 fail" (and "· 2 unset" / "· 1 invalid" when there are any) for statuses. always
// shows the unset and invalid counts even at 0; invalid names the last count ("errors", …).
export const headline = (statuses, { always = false, invalid = "invalid" } = {}) => {
	const n = (s) => statuses.filter((x) => x === s).length;
	const parts = [`${n("pass")} pass`, `${n("fail")} fail`];
	if (always || n("none") > 0) parts.push(`${n("none")} unset`);
	const bad = n("invalid") + n("error");
	if (always || bad > 0) parts.push(`${bad} ${invalid}`);
	return parts.join(" · ");
};
