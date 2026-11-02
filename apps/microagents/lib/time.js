// Time helpers the agents share, always in UTC so results don't depend on the machine.
export const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const pad = (n, width = 2, fill = "0") => String(n).padStart(width, fill);

const ISO =
	/^([+-]?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
// An ISO 8601 time as epoch milliseconds, or NaN. A time without an offset is UTC.
export const parseIso = (text) => {
	const m = ISO.exec(String(text).trim());
	if (m === null) return Number.NaN;
	const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0", zone = "Z"] = m;
	const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Math.floor(+`0.${frac}` * 1000));
	if (zone.toUpperCase() === "Z") return ms;
	const sign = zone[0] === "-" ? -1 : 1;
	const digits = zone.slice(1).replace(":", "");
	return ms - sign * (+digits.slice(0, 2) * 60 + +digits.slice(2)) * 60000;
};
