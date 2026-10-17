// Time helpers of thing-tracker (src/lib/time.ts). Timestamps are epoch ms; tz is the
// offset of local time from UTC in minutes (-new Date().getTimezoneOffset()), passed in
// so results don't depend on the machine running them.
export const MINUTE = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
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
const pad = (n) => String(n).padStart(2, "0");

// A Date whose UTC fields read as the local time of ts.
const local = (ts, tz) => new Date(ts + tz * MINUTE);
const fromLocal = (date, tz) => date.getTime() - tz * MINUTE;

export const startOfDay = (ts, tz) => {
	const d = local(ts, tz);
	return fromLocal(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), tz);
};
export const startOfIsoWeek = (ts, tz) => {
	const dow = local(ts, tz).getUTCDay() || 7;
	return startOfDay(ts, tz) - (dow - 1) * DAY;
};
export const startOfMonth = (ts, tz) => {
	const d = local(ts, tz);
	return fromLocal(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), tz);
};
// The start of the next bucket, by calendar.
export const bucketEnd = (start, granularity, tz) => {
	if (granularity === "day") return startOfDay(start + DAY + 2 * HOUR, tz);
	if (granularity === "week") return startOfDay(start + 7 * DAY + 2 * HOUR, tz);
	const d = local(start, tz);
	return fromLocal(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)), tz);
};
export const dayKey = (ts, tz) => {
	const d = local(ts, tz);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const monthKey = (ts, tz) => dayKey(ts, tz).slice(0, 7);
export const isoWeekKey = (ts, tz) => {
	const d = local(startOfDay(ts, tz), tz);
	const dow = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dow);
	const y = d.getUTCFullYear();
	const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
	return `${y}-W${pad(week)}`;
};

// 24 hour "HH:MM", where the original used the locale's format.
export const formatTime = (ts, tz) => {
	const d = local(ts, tz);
	return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
// "Fri 16 Oct", with the year when it isn't now's; weekday false leaves it out.
export const formatDate = (ts, tz, { weekday = true, now = ts } = {}) => {
	const d = local(ts, tz);
	const head = `${weekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ""}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
	return local(now, tz).getUTCFullYear() === d.getUTCFullYear()
		? head
		: `${head} ${d.getUTCFullYear()}`;
};
export const formatRelative = (ts, now, tz) => {
	const diff = now - ts;
	if (diff < 0) return "scheduled";
	if (diff < 45000) return "just now";
	if (diff < HOUR) return `${Math.round(diff / MINUTE)}m ago`;
	if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
	const days = Math.round((startOfDay(now, tz) - startOfDay(ts, tz)) / DAY);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days}d ago`;
	return formatDate(ts, tz, { weekday: false });
};
export const formatBucketLabel = (start, granularity, now, tz) => {
	const d = local(start, tz);
	if (granularity === "month") return `${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
	if (granularity === "week") {
		const end = local(start + 6 * DAY + 2 * HOUR, tz);
		const sameMonth = end.getUTCMonth() === d.getUTCMonth();
		const from = sameMonth ? `${d.getUTCDate()}` : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
		return `${from} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
	}
	const diffDays = Math.round((startOfDay(now, tz) - start) / DAY);
	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	return formatDate(start, tz, { now });
};
export const toDatetimeLocal = (ts, tz) => {
	const d = local(ts, tz);
	return `${dayKey(ts, tz)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
export const fromDatetimeLocal = (text, tz) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
	if (m === null) return null;
	const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
	const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
	return Number.isNaN(date.getTime()) ? null : fromLocal(date, tz);
};
// "today", "yesterday" or "N days ago", for backups.
export const daysAgo = (ts, now) => {
	const days = Math.floor((now - ts) / DAY);
	return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
