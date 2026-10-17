// Built-in measurements and unit math of thing-tracker (src/measurements/definitions.ts,
// src/lib/measure). Values are stored in a measurement's base unit; a unit converts with
// base = value * factor + (offset ?? 0). Ids are slugs here, uuids there.
const unit = (id, label, symbol, factor, precision, offset) => ({
	id,
	label,
	symbol,
	factor,
	precision,
	...(offset === undefined ? {} : { offset }),
});
const measurement = (id, name, emoji, baseUnit, defaultUnit, units, steps, stepUnit) => ({
	id,
	name,
	emoji,
	baseUnit,
	defaultUnit,
	units,
	steps,
	stepUnit,
});

export const MEASUREMENTS = [
	measurement(
		"duration",
		"Duration",
		"⏱️",
		"ms",
		"min",
		[
			unit("ms", "milliseconds", "ms", 1, 0),
			unit("s", "seconds", "s", 1000, 0),
			unit("min", "minutes", "m", 60000, 0),
			unit("h", "hours", "h", 3600000, 2),
			unit("d", "days", "d", 86400000, 2),
		],
		[1, 5, 10, 15, 30, 60],
		"min",
	),
	measurement(
		"count",
		"Count",
		"🔢",
		"x",
		"x",
		[unit("x", "times", "×", 1, 0)],
		[1, 2, 5, 10, 25, 100],
		"x",
	),
	measurement(
		"distance",
		"Distance",
		"📏",
		"m",
		"km",
		[
			unit("cm", "centimetres", "cm", 0.01, 1),
			unit("m", "metres", "m", 1, 1),
			unit("km", "kilometres", "km", 1000, 2),
			unit("in", "inches", "in", 0.0254, 1),
			unit("ft", "feet", "ft", 0.3048, 1),
			unit("yd", "yards", "yd", 0.9144, 1),
			unit("mi", "miles", "mi", 1609.344, 2),
		],
		[0.1, 0.5, 1, 2, 5, 10],
		"km",
	),
	measurement(
		"weight",
		"Weight",
		"⚖️",
		"g",
		"kg",
		[
			unit("g", "grams", "g", 1, 0),
			unit("kg", "kilograms", "kg", 1000, 2),
			unit("oz", "ounces", "oz", 28.349523125, 1),
			unit("lb", "pounds", "lb", 453.59237, 2),
			unit("st", "stone", "st", 6350.29318, 2),
		],
		[0.1, 0.5, 1, 2, 5, 10],
		"kg",
	),
	measurement(
		"volume",
		"Volume",
		"🥤",
		"ml",
		"ml",
		[
			unit("ml", "millilitres", "ml", 1, 0),
			unit("l", "litres", "l", 1000, 2),
			unit("floz", "fluid ounces (US)", "fl oz", 29.5735295625, 1),
			unit("cup", "cups (US)", "cup", 236.5882365, 2),
			unit("pt", "pints (US)", "pt", 473.176473, 2),
			unit("galuk", "gallons (UK)", "gal", 4546.09, 2),
		],
		[50, 100, 250, 330, 500, 1000],
		"ml",
	),
	measurement(
		"temperature",
		"Temperature",
		"🌡️",
		"c",
		"c",
		[
			unit("c", "Celsius", "°C", 1, 1),
			unit("f", "Fahrenheit", "°F", 5 / 9, 1, -160 / 9),
			unit("k", "Kelvin", "K", 1, 1, -273.15),
		],
		[0.1, 0.5, 1, 5],
		"c",
	),
	measurement(
		"energy",
		"Energy",
		"🔥",
		"kcal",
		"kcal",
		[unit("kcal", "kilocalories", "kcal", 1, 0), unit("kj", "kilojoules", "kJ", 0.239005736, 0)],
		[10, 50, 100, 250, 500],
		"kcal",
	),
	measurement(
		"steps",
		"Steps",
		"👣",
		"step",
		"step",
		[unit("step", "steps", " steps", 1, 0)],
		[100, 500, 1000, 2500, 5000],
		"step",
	),
	measurement(
		"rating",
		"Rating",
		"⭐",
		"pt",
		"pt",
		[unit("pt", "out of 10", "/10", 1, 1)],
		[0.5, 1, 2],
		"pt",
	),
];

export const findMeasurement = (measurements, id) => measurements.find((m) => m.id === id);
export const findUnit = (units, id) => units.find((u) => u.id === id);
export const toBase = (value, u) => value * u.factor + (u.offset ?? 0);
export const fromBase = (base, u) => (base - (u.offset ?? 0)) / u.factor;
export const roundTo = (value, precision) => Math.round(value * 10 ** precision) / 10 ** precision;

// The largest ratio unit the value reaches, else the smallest, else fallback.
export const naturalUnit = (base, units, fallback) => {
	const ratio = units.filter((u) => u.offset === undefined).sort((a, b) => b.factor - a.factor);
	return ratio.find((u) => Math.abs(base) >= u.factor) ?? ratio.at(-1) ?? fallback;
};
export const preferredUnit = (m, thingUnitId, current) =>
	findUnit(m.units, thingUnitId) ??
	findUnit(m.units, m.defaultUnit) ??
	(current === undefined ? m.units[0] : naturalUnit(current, m.units, m.units[0]));

export const formatDurationMs = (ms) => {
	if (ms <= 0) return "0m";
	const d = Math.floor(ms / 86400000);
	const h = Math.floor((ms % 86400000) / 3600000);
	const m = Math.floor((ms % 3600000) / 60000);
	const s = Math.round((ms % 60000) / 1000);
	if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	if (m > 0) return s > 0 && m < 5 ? `${m}m ${s}s` : `${m}m`;
	return `${s}s`;
};
export const formatMeasurement = (m, base, preferredUnitId) => {
	if (m.baseUnit === "ms") return formatDurationMs(base);
	const u = findUnit(m.units, preferredUnitId) ?? findUnit(m.units, m.defaultUnit) ?? m.units[0];
	return `${roundTo(fromBase(base, u), u.precision ?? 2)}${u.symbol}`;
};
// The values seen most often, ties to the smaller one.
export const commonValues = (values, limit = 6) => {
	const counts = new Map();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts.entries()]
		.sort(([a, ca], [b, cb]) => cb - ca || a - b)
		.slice(0, limit)
		.map(([v]) => v);
};
// The text an input shows for base in unit u.
export const textIn = (base, u) => String(roundTo(fromBase(base, u), u.precision ?? 2));
