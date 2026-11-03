// Host functions for datefmt-lab: instants formatted by strftime patterns
// (implemented here, in UTC) and by Intl.DateTimeFormat (in UTC unless the
// options name a timeZone, with en-US when the locale is empty), so the
// output never depends on the machine.
//
//   datefmt_iso(text)                        text as an ISO time (toISOString); throws when it isn't one
//   datefmt_strftime(format, iso)            { text, error }: the pattern applied to the instant
//                                            (error "" when every directive is known)
//   datefmt_strftime_errors(format)          "" or why the pattern has errors ("; " between them)
//   datefmt_intl(locale, options, iso)       { text, error }: Intl.DateTimeFormat's output
//   datefmt_intl_info(locale, options)       { error, resolved: ["option: value"] }
//   datefmt_parts(locale, options, iso)      Intl's formatToParts: [{ type, value }] ([] when it can't format)
//   datefmt_option_rows(options)             the Intl options a select offers, with options' values:
//                                            [{ name, value, choices: [{ value, label }] }]
//   datefmt_directives()                     { "%a": what it gives, … }
//
// options is a map of strings: hour12 is "true" or "false".
export const bundle = null;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n, width = 2, fill = "0") => String(n).padStart(width, fill);
const DEFAULT_LOCALE = "en-US";
const DAY_MS = 86400000;

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
const msOf = (iso) => {
	const ms = parseIso(iso);
	if (Number.isNaN(ms) || Math.abs(ms) > 8.64e15) throw new Error(`"${iso}" isn't an ISO time`);
	return ms;
};

const yday = (d) => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS); // 0-based
// The ISO 8601 week-numbering year and week of d.
const isoWeek = (d) => {
	const thursday = new Date(+d + (3 - ((d.getUTCDay() + 6) % 7)) * DAY_MS);
	return { year: thursday.getUTCFullYear(), week: 1 + Math.floor(yday(thursday) / 7) };
};
const hour12 = (d) => d.getUTCHours() % 12 || 12;

// The directives: letter → [what it gives, (date) → text]. Every one reads the UTC fields.
const D = {
	a: ["abbreviated weekday (Mon)", (d) => DAYS[d.getUTCDay()].slice(0, 3)],
	A: ["full weekday (Monday)", (d) => DAYS[d.getUTCDay()]],
	b: ["abbreviated month (Jan)", (d) => MONTHS[d.getUTCMonth()].slice(0, 3)],
	h: ["same as %b", (d) => MONTHS[d.getUTCMonth()].slice(0, 3)],
	B: ["full month (January)", (d) => MONTHS[d.getUTCMonth()]],
	c: ["date and time (Tue Mar  5 14:07:09 2024)", (d) => strftime("%a %b %e %H:%M:%S %Y", +d).text],
	C: ["century, 2 digits", (d) => pad(Math.floor(d.getUTCFullYear() / 100))],
	d: ["day of the month, 01-31", (d) => pad(d.getUTCDate())],
	D: ["%m/%d/%y", (d) => strftime("%m/%d/%y", +d).text],
	e: ["day of the month, space-padded ( 5)", (d) => pad(d.getUTCDate(), 2, " ")],
	F: ["%Y-%m-%d", (d) => strftime("%Y-%m-%d", +d).text],
	g: ["ISO week-numbering year, 2 digits", (d) => pad(isoWeek(d).year % 100)],
	G: ["ISO week-numbering year", (d) => String(isoWeek(d).year)],
	H: ["hour, 00-23", (d) => pad(d.getUTCHours())],
	I: ["hour, 01-12", (d) => pad(hour12(d))],
	j: ["day of the year, 001-366", (d) => pad(yday(d) + 1, 3)],
	k: ["hour, space-padded ( 0-23)", (d) => pad(d.getUTCHours(), 2, " ")],
	l: ["hour, space-padded ( 1-12)", (d) => pad(hour12(d), 2, " ")],
	L: ["milliseconds, 000-999", (d) => pad(d.getUTCMilliseconds(), 3)],
	m: ["month, 01-12", (d) => pad(d.getUTCMonth() + 1)],
	M: ["minute, 00-59", (d) => pad(d.getUTCMinutes())],
	n: ["a newline", () => "\n"],
	p: ["AM or PM", (d) => (d.getUTCHours() < 12 ? "AM" : "PM")],
	P: ["am or pm", (d) => (d.getUTCHours() < 12 ? "am" : "pm")],
	r: ["%I:%M:%S %p", (d) => strftime("%I:%M:%S %p", +d).text],
	R: ["%H:%M", (d) => strftime("%H:%M", +d).text],
	s: ["seconds since the epoch", (d) => String(Math.floor(+d / 1000))],
	S: ["second, 00-60", (d) => pad(d.getUTCSeconds())],
	t: ["a tab", () => "\t"],
	T: ["%H:%M:%S", (d) => strftime("%H:%M:%S", +d).text],
	u: ["weekday, 1-7 (Monday is 1)", (d) => String(d.getUTCDay() || 7)],
	U: ["week of the year, Sunday first, 00-53", (d) => pad(Math.floor((yday(d) + 7 - d.getUTCDay()) / 7))],
	V: ["ISO week, 01-53", (d) => pad(isoWeek(d).week)],
	w: ["weekday, 0-6 (Sunday is 0)", (d) => String(d.getUTCDay())],
	W: ["week of the year, Monday first, 00-53", (d) => pad(Math.floor((yday(d) + 7 - ((d.getUTCDay() + 6) % 7)) / 7))],
	x: ["%m/%d/%y", (d) => strftime("%m/%d/%y", +d).text],
	X: ["%H:%M:%S", (d) => strftime("%H:%M:%S", +d).text],
	y: ["year, 2 digits", (d) => pad(d.getUTCFullYear() % 100)],
	Y: ["year", (d) => String(d.getUTCFullYear())],
	z: ["offset from UTC (+0000)", () => "+0000"],
	Z: ["timezone name (UTC)", () => "UTC"],
	"%": ["a literal %", () => "%"],
};
// fmt applied to the instant at ms, in UTC: { text, errors }. %-x drops x's
// padding; an unknown directive is written as [%x?] and reported.
function strftime(fmt, ms) {
	const d = new Date(ms);
	const errors = [];
	let text = "";
	for (let i = 0; i < fmt.length; i++) {
		if (fmt[i] !== "%") {
			text += fmt[i];
			continue;
		}
		const noPad = fmt[i + 1] === "-";
		const at = i;
		i += noPad ? 2 : 1;
		const c = fmt[i];
		if (c === undefined) {
			errors.push(`a lone % at the end (position ${at})`);
			text += "[%?]";
		} else if (D[c] === undefined) {
			errors.push(`unknown directive %${c} at position ${at}`);
			text += `[%${c}?]`;
		} else {
			const out = D[c][1](d);
			text += noPad ? out.replace(/^[0 ]+(?=.)/, "") : out;
		}
	}
	return { text, errors };
}

// The Intl options a select offers; timeZone also takes any IANA name through the tools.
const STYLES = ["full", "long", "medium", "short"];
const TEXTS = ["long", "short", "narrow"];
const DIGITS = ["numeric", "2-digit"];
const CHOICES = {
	dateStyle: STYLES,
	timeStyle: STYLES,
	weekday: TEXTS,
	era: TEXTS,
	year: DIGITS,
	month: [...DIGITS, ...TEXTS],
	day: DIGITS,
	hour: DIGITS,
	minute: DIGITS,
	second: DIGITS,
	hour12: ["true", "false"],
	timeZone: ["UTC", "America/New_York", "America/Los_Angeles", "America/Argentina/Buenos_Aires", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"],
	timeZoneName: ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"],
};
// The options as Intl takes them: hour12 a boolean, UTC unless a timeZone is given.
const intlOptions = (options) => {
	const out = { timeZone: "UTC" };
	for (const [k, v] of Object.entries(options ?? {})) out[k] = k === "hour12" ? String(v) === "true" : v;
	return out;
};
const formatters = new Map();
// { fmt, error } for locale and options, remembered by their text.
const formatter = (locale, options) => {
	const key = JSON.stringify([locale, Object.entries(options ?? {}).sort()]);
	if (!formatters.has(key)) {
		if (formatters.size > 256) formatters.clear();
		try {
			formatters.set(key, { fmt: new Intl.DateTimeFormat(locale || DEFAULT_LOCALE, intlOptions(options)), error: "" });
		} catch (error) {
			formatters.set(key, { fmt: null, error: error.message });
		}
	}
	return formatters.get(key);
};

export const make = () => ({
	datefmt_iso: (text) => new Date(msOf(text)).toISOString(),
	datefmt_strftime: (format, iso) => {
		const { text, errors } = strftime(String(format), msOf(iso));
		return { text, error: errors.join("; ") };
	},
	datefmt_strftime_errors: (format) => strftime(String(format), 0).errors.join("; "),
	datefmt_intl: (locale, options, iso) => {
		const ms = msOf(iso);
		const { fmt, error } = formatter(locale, options);
		if (fmt === null) return { text: "", error };
		try {
			return { text: fmt.format(ms), error: "" };
		} catch (e) {
			return { text: "", error: e.message };
		}
	},
	datefmt_intl_info: (locale, options) => {
		const { fmt, error } = formatter(locale, options);
		if (fmt === null) return { error, resolved: [] };
		return { error: "", resolved: Object.entries(fmt.resolvedOptions()).map(([k, v]) => `${k}: ${v}`) };
	},
	datefmt_parts: (locale, options, iso) => {
		const { fmt } = formatter(locale, options);
		if (fmt === null) return [];
		try {
			return fmt.formatToParts(msOf(iso)).map(({ type, value }) => ({ type, value }));
		} catch {
			return [];
		}
	},
	datefmt_option_rows: (options) =>
		Object.entries(CHOICES).map(([name, choices]) => {
			const value = options?.[name] ?? "";
			const values = ["", ...choices];
			if (!values.includes(value)) values.push(value);
			return { name, value, choices: values.map((v) => ({ value: v, label: v || "—" })) };
		}),
	datefmt_directives: () => Object.fromEntries(Object.entries(D).map(([c, [what]]) => [`%${c}`, what])),
});
