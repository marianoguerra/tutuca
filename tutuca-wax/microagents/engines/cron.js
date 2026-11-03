// Host functions for cron-lab: standard 5-field cron expressions (minute
// hour day month weekday, or a macro), parsed, described in English and run
// forward. Runs are computed in UTC, so the same data always gives the same
// runs; a timezone only says how a run reads there (through Intl).
//
//   cron_explain(expression)            { error, field, description, fields: { minute: { text, values }, … } }
//                                       (error "" when it parses; field names the field at fault)
//   cron_next(expression, timezone, from_iso, n)
//                                       the next n runs strictly after from_iso: [{ iso, local }]
//                                       (local: the run in timezone, "" for UTC); throws when invalid
//   cron_iso(text)                      text as a normalized ISO time (UTC, "…:00Z" trimmed to "…Z"); throws when it isn't one
//   cron_with_field(expression, field, value)
//                                       expression with one field replaced (a macro spelled out first)
//   cron_toggle(expression, field, value)
//                                       expression with value of field turned on or off
//   cron_chips(expression)              the builder: per field a label, then a chip per value it can take,
//                                       [{ label, status: "label" | "on" | "off", title }]
export const bundle = null;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n, width = 2, fill = "0") => String(n).padStart(width, fill);
const MINUTE = 60000;

const ISO = /^([+-]?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
// An ISO 8601 time as epoch milliseconds, or NaN. A time without an offset is UTC.
const parseIso = (text) => {
	const m = ISO.exec(String(text).trim());
	if (m === null) return Number.NaN;
	const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0", zone = "Z"] = m;
	const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Math.floor(+`0.${frac}` * 1000));
	if (zone.toUpperCase() === "Z") return ms;
	const sign = zone[0] === "-" ? -1 : 1;
	const digits = zone.slice(1).replace(":", "");
	return ms - sign * (+digits.slice(0, 2) * 60 + +digits.slice(2)) * 60000;
};
const isoOf = (ms) => new Date(ms).toISOString().replace(":00.000Z", "Z");

const abbrev = (names) => names.map((n) => n.slice(0, 3).toUpperCase());
// The five fields: their range, the names they accept and how a value reads in English.
const FIELDS = [
	{ name: "minute", min: 0, max: 59, unit: "minute", label: String },
	{ name: "hour", min: 0, max: 23, unit: "hour", label: String },
	{ name: "day", min: 1, max: 31, unit: "day", label: String },
	{ name: "month", min: 1, max: 12, unit: "month", names: abbrev(MONTHS), label: (v) => MONTHS[v - 1] },
	{ name: "weekday", min: 0, max: 7, unit: "day of the week", names: abbrev(DAYS), label: (v) => DAYS[v % 7] },
];
const FIELD_NAMES = FIELDS.map((f) => f.name);
const fieldOf = (name) => {
	const f = FIELDS[FIELD_NAMES.indexOf(name)];
	if (f === undefined) throw new Error(`no field ${name} (use ${FIELD_NAMES.join(", ")})`);
	return f;
};
const MACROS = {
	"@yearly": "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly": "0 0 1 * *",
	"@weekly": "0 0 * * 0",
	"@daily": "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly": "0 * * * *",
};

// One field's text as { values: Set, star, parts } or { error }. A part is
// { from, to, step, all, single }; weekday 7 is Sunday, as 0 is.
const parseField = (text, f) => {
	const atom = (s) => {
		const named = f.names?.indexOf(s.toUpperCase()) ?? -1;
		if (named >= 0) return named + (f.name === "month" ? 1 : 0);
		if (!/^\d+$/.test(s)) throw new Error(`"${s}" isn't a number${f.names ? " or a name" : ""}`);
		const n = Number(s);
		if (n < f.min || n > f.max) throw new Error(`${n} is out of range ${f.min}-${f.max}`);
		return n;
	};
	try {
		const values = new Set();
		const parts = text.split(",").map((item) => {
			const m = /^([^/]+)(?:\/(\d+))?$/.exec(item);
			if (m === null) throw new Error(`"${item}" isn't a value, range or step`);
			const step = m[2] === undefined ? 1 : Number(m[2]);
			if (step < 1) throw new Error(`the step in "${item}" must be at least 1`);
			let from;
			let to;
			const all = m[1] === "*";
			if (all) [from, to] = [f.min, f.name === "weekday" ? 6 : f.max];
			else {
				const ends = m[1].split("-");
				if (ends.length > 2) throw new Error(`"${m[1]}" isn't a range`);
				from = atom(ends[0]);
				to = ends.length === 2 ? atom(ends[1]) : m[2] === undefined ? from : f.max;
				if (to < from) throw new Error(`the range "${m[1]}" goes backwards`);
			}
			for (let v = from; v <= to; v += step) values.add(f.name === "weekday" ? v % 7 : v);
			return { from, to, step, all, single: !all && from === to };
		});
		return { values, star: text.startsWith("*"), parts };
	} catch (error) {
		return { error: error.message };
	}
};

// An expression as { fields: { minute: …, … }, texts: [5 strings] } or { error, field }.
const parseUncached = (expression) => {
	const trimmed = String(expression).trim();
	const lower = trimmed.toLowerCase();
	if (lower.startsWith("@")) {
		if (MACROS[lower] === undefined) return { error: `unknown macro ${trimmed} (use ${Object.keys(MACROS).join(", ")})`, field: "" };
		return parseUncached(MACROS[lower]);
	}
	const texts = trimmed === "" ? [] : trimmed.split(/\s+/);
	if (texts.length !== 5) return { error: `expected 5 fields (minute hour day month weekday), got ${texts.length}`, field: "" };
	const fields = {};
	for (const [i, f] of FIELDS.entries()) {
		const parsed = parseField(texts[i], f);
		if (parsed.error !== undefined) return { error: `${f.name}: ${parsed.error}`, field: f.name };
		fields[f.name] = parsed;
	}
	return { fields, texts };
};
const memo = (fn) => {
	const cache = new Map();
	return (key) => {
		if (!cache.has(key)) {
			if (cache.size > 256) cache.clear();
			cache.set(key, fn(key));
		}
		return cache.get(key);
	};
};
const parseCron = memo(parseUncached);
const valid = (expression) => {
	const parsed = parseCron(expression);
	if (parsed.error !== undefined) throw new Error(parsed.error);
	return parsed;
};

// Whether the day of d matches: with both day and weekday restricted, either one does.
const dayMatches = ({ day, weekday }, d) => {
	const dom = day.values.has(d.getUTCDate());
	const dow = weekday.values.has(d.getUTCDay());
	return day.star || weekday.star ? dom && dow : dom || dow;
};
// The next count runs strictly after fromMs, as epoch ms (fewer when it never
// runs again within 50 years).
const nextRuns = (fields, fromMs, count) => {
	const out = [];
	let at = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE;
	const until = at + 50 * 366 * 24 * 60 * MINUTE;
	while (out.length < count && at < until) {
		const d = new Date(at);
		const [y, mo, day, h] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()];
		if (!fields.month.values.has(mo + 1)) at = Date.UTC(y, mo + 1, 1);
		else if (!dayMatches(fields, d)) at = Date.UTC(y, mo, day + 1);
		else if (!fields.hour.values.has(h)) at = Date.UTC(y, mo, day, h + 1);
		else {
			if (fields.minute.values.has(d.getUTCMinutes())) out.push(at);
			at += MINUTE;
		}
	}
	return out;
};

const listText = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const plural = (f, n) => (n === 1 ? f.unit : `${n} ${f.unit.replace(/^(\w+)/, "$1s")}`);
// One comma part of a field in English: "every 15 minutes", "Monday through Friday", "9".
const partText = (f, p) => {
	if (p.all) return `every ${plural(f, p.step)}`;
	const range = p.single ? f.label(p.from) : `${f.label(p.from)} through ${f.label(p.to)}`;
	return p.step === 1 ? range : `every ${plural(f, p.step)} from ${range}`;
};
const fieldText = (f, parsed, one, many) => {
	const parts = parsed.parts.map((p) => partText(f, p));
	const steps = parsed.parts.every((p) => p.step > 1 || p.all);
	return steps ? listText(parts) : `${parsed.values.size === 1 ? one : many}${listText(parts)}`;
};
const isAll = (parsed) => parsed.parts.some((p) => p.all && p.step === 1);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The English for parsed fields: "At 09:30 on Monday through Friday".
const describe = ({ minute, hour, day, month, weekday }) => {
	const [fm, fh, fd, fmo, fw] = FIELDS;
	const singles = (x) => x.parts.every((p) => p.single);
	let time;
	if (singles(minute) && singles(hour) && minute.values.size * hour.values.size <= 6) {
		const times = [...hour.values]
			.sort((a, b) => a - b)
			.flatMap((h) => [...minute.values].sort((a, b) => a - b).map((m) => `${pad(h)}:${pad(m)}`));
		time = `At ${listText(times)}`;
	} else {
		time = isAll(minute) ? "Every minute" : capital(fieldText(fm, minute, "at minute ", "at minutes "));
		if (!isAll(hour)) time += `, ${fieldText(fh, hour, "during hour ", "during hours ")}`;
	}
	const days = [];
	if (!isAll(day)) days.push(`${fieldText(fd, day, "on day ", "on days ")} of the month`);
	if (!isAll(weekday)) days.push(fieldText(fw, weekday, "on ", "on "));
	let out = `${time}${days.length > 0 ? ` ${days.join(day.star || weekday.star ? ", " : " or ")}` : ""}`;
	if (!isAll(month)) out += ` ${fieldText(fmo, month, "in ", "in ")}`;
	return out;
};

// A field's values as compact text: "*", "*/15", "1-5,10".
const serialize = (values, f) => {
	const top = f.name === "weekday" ? 6 : f.max;
	const xs = [...values].sort((a, b) => a - b);
	if (xs.length === 0 || xs.length === top - f.min + 1) return "*";
	const step = xs[1] - xs[0];
	const progression = xs.every((v, i) => v === f.min + i * step) && xs.at(-1) + step > top;
	if (xs.length > 1 && step > 1 && progression) return `*/${step}`;
	const out = [];
	for (let i = 0; i < xs.length; ) {
		let j = i;
		while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
		if (j - i >= 2) out.push(`${xs[i]}-${xs[j]}`);
		else for (let k = i; k <= j; k++) out.push(String(xs[k]));
		i = j + 1;
	}
	return out.join(",");
};
// expression with one field replaced; a macro is spelled out first.
const withField = (expression, name, value) => {
	const lower = String(expression).trim().toLowerCase();
	const texts = (MACROS[lower] ?? String(expression)).trim().split(/\s+/);
	const five = FIELDS.map((_, i) => texts[i] ?? "*");
	five[FIELD_NAMES.indexOf(name)] = String(value).trim() === "" ? "*" : String(value).trim();
	return five.join(" ");
};

// How a run at ms reads in timezone ("" for UTC; the error when timezone isn't one).
const locals = new Map();
const localOf = (ms, timezone) => {
	if (timezone === "" || timezone.toUpperCase() === "UTC") return "";
	if (!locals.has(timezone)) {
		try {
			locals.set(timezone, new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }));
		} catch (error) {
			locals.set(timezone, error.message);
		}
	}
	const fmt = locals.get(timezone);
	return typeof fmt === "string" ? fmt : fmt.format(ms).replace(",", "");
};

export const make = () => ({
	cron_explain: (expression) => {
		const parsed = parseCron(expression);
		if (parsed.error !== undefined) return { error: parsed.error, field: parsed.field, description: "", fields: {} };
		const fields = {};
		for (const [i, n] of FIELD_NAMES.entries())
			fields[n] = { text: parsed.texts[i], values: [...parsed.fields[n].values].sort((a, b) => a - b) };
		return { error: "", field: "", description: describe(parsed.fields), fields };
	},
	cron_next: (expression, timezone, fromIso, n) => {
		const { fields } = valid(expression);
		const from = parseIso(fromIso);
		if (Number.isNaN(from)) throw new Error(`"${fromIso}" isn't an ISO time`);
		const count = Math.max(1, Math.min(100, Math.floor(Number(n) || 1)));
		return nextRuns(fields, from, count).map((ms) => ({ iso: isoOf(ms), local: localOf(ms, String(timezone)) }));
	},
	cron_iso: (text) => {
		const ms = parseIso(text);
		if (Number.isNaN(ms)) throw new Error(`"${text}" isn't an ISO time`);
		return isoOf(ms);
	},
	cron_with_field: (expression, name, value) => {
		fieldOf(name);
		return withField(expression, name, value);
	},
	cron_toggle: (expression, name, value) => {
		const f = fieldOf(name);
		const parsed = parseCron(expression);
		const values = new Set(parsed.fields?.[name].values ?? []);
		if (values.has(value)) values.delete(value);
		else values.add(value);
		return withField(expression, name, serialize(values, f));
	},
	cron_chips: (expression) => {
		const parsed = parseCron(expression);
		const out = [];
		for (const f of FIELDS) {
			out.push({ label: f.name, status: "label", title: "" });
			const top = f.name === "weekday" ? 6 : f.max;
			for (let v = f.min; v <= top; v++) {
				const on = parsed.fields?.[f.name].values.has(v) ?? false;
				const label = f.names ? f.names[f.name === "month" ? v - 1 : v] : pad(v);
				out.push({ label, status: on ? "on" : "off", title: `${f.name} ${v}` });
			}
		}
		return out;
	},
});
