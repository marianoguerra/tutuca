// Calendar dates as ISO strings (YYYY-MM-DD), computed in UTC so no time zone shifts a day.
const DAY_MS = 86400000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const parseIso = (iso) => {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d));
};
export const toIso = (date) => date.toISOString().slice(0, 10);
export const isIso = (s) => typeof s === "string" && ISO.test(s) && toIso(parseIso(s)) === s;
export const isoToday = (now = new Date()) =>
	toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
export const addDays = (iso, n) => toIso(new Date(parseIso(iso).getTime() + n * DAY_MS));
export const daysBetween = (from, to) => Math.round((parseIso(to) - parseIso(from)) / DAY_MS);
const weekdayOf = (iso) => parseIso(iso).getUTCDay();
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

// "Today", "Tomorrow", "Yesterday", a weekday within the week, else "Oct 17" (with the year
// when it isn't today's).
export const dueLabel = (due, today) => {
	if (!isIso(due) || !isIso(today)) return due;
	const n = daysBetween(today, due);
	if (n === 0) return "Today";
	if (n === 1) return "Tomorrow";
	if (n === -1) return "Yesterday";
	if (n > 1 && n < 7) return capitalize(WEEKDAYS[weekdayOf(due)]);
	const date = parseIso(due);
	const label = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
	return due.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${due.slice(0, 4)}`;
};
// How urgent a due date is, for its color.
export const dueTone = (due, today) => {
	if (!isIso(due) || !isIso(today)) return "none";
	const n = daysBetween(today, due);
	if (n < 0) return "overdue";
	if (n === 0) return "today";
	if (n === 1) return "tomorrow";
	return n < 7 ? "week" : "later";
};
// A day header for the upcoming view: "Fri 17 Oct · Today".
export const dayHeader = (due, today) => {
	const date = parseIso(due);
	const head = `${capitalize(WEEKDAYS[date.getUTCDay()]).slice(0, 3)} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
	const relative = dueLabel(due, today);
	return /^[A-Z][a-z]{2} \d/.test(relative) ? head : `${head} · ${relative}`;
};

// The date a run of words starting at words[i] names, as { due, used } with the number of
// words it took, or null. Understands today/tod, tomorrow/tom, yesterday, weekday names and
// their first three letters (the next one, today included), "next week" (next Monday),
// "in N days", "in N weeks" and ISO dates.
export const parseDueWords = (words, i, today) => {
	const w = words[i]?.toLowerCase();
	if (w === undefined) return null;
	if (w === "today" || w === "tod") return { due: today, used: 1 };
	if (w === "tomorrow" || w === "tom") return { due: addDays(today, 1), used: 1 };
	if (w === "yesterday") return { due: addDays(today, -1), used: 1 };
	if (isIso(w)) return { due: w, used: 1 };
	const day = WEEKDAYS.findIndex((name) => name === w || name.slice(0, 3) === w);
	if (day >= 0) return { due: addDays(today, (day - weekdayOf(today) + 7) % 7), used: 1 };
	const next = words[i + 1]?.toLowerCase();
	if (w === "next" && next === "week") {
		return { due: addDays(today, (1 - weekdayOf(today) + 7) % 7 || 7), used: 2 };
	}
	const unit = words[i + 2]?.toLowerCase();
	if (w === "in" && /^\d+$/.test(next ?? "") && /^(days?|weeks?)$/.test(unit ?? "")) {
		const n = Number(next) * (unit.startsWith("week") ? 7 : 1);
		return { due: addDays(today, n), used: 3 };
	}
	return null;
};
