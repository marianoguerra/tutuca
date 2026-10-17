// Calendar bits more than one component (and the demos) use.
export const DAY = 86400000;
export const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
export const pad = (n) => String(n).padStart(2, "0");
// The local date of a Date as YYYY-MM-DD.
export const isoDay = (date) =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
