// The domain logic of thing-tracker (src/domain, src/transfer) as pure functions over plain
// records: things, groups (tags), events and measurements.
import { BUNDLE_DEFS } from "./bundle-defs.js";
import {
	bucketEnd,
	DAY,
	dayKey,
	isoWeekKey,
	monthKey,
	startOfDay,
	startOfIsoWeek,
	startOfMonth,
} from "./time.js";

export const PACK = "thing-tracker/group-pack";
export const BACKUP = "thing-tracker/backup";
export const UNGROUPED = "__ungrouped__";
const HOUR12 = 12 * 3600000;

export const normalize = (s) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim();
export const terms = (q) => normalize(q).split(/\s+/).filter(Boolean);
// All terms must match; an exact emoji query wins outright.
export const scoreThing = (thing, rawQuery) => {
	if (thing.emoji === rawQuery.trim()) return 100;
	const title = normalize(thing.title);
	const description = normalize(thing.description ?? "");
	let score = 0;
	for (const part of terms(rawQuery)) {
		if (title === part) score += 40;
		else if (title.startsWith(part)) score += 25;
		else if (title.includes(part)) score += 12;
		else if (description.includes(part)) score += 4;
		else return 0;
	}
	return score;
};
export const filterThings = (things, query) =>
	things
		.map((thing, i) => ({ thing, i, score: scoreThing(thing, query) }))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map((r) => r.thing);
// Every term in the joined, normalized fields.
export const matchesQuery = (fields, query) => {
	const hay = normalize(fields.filter(Boolean).join(" "));
	return terms(query).every((t) => hay.includes(t));
};

// { total, lastAt } of each thing id, from its events.
export const usageOf = (events) => {
	const usage = new Map();
	for (const e of events) {
		const u = usage.get(e.thingId) ?? { total: 0, lastAt: 0 };
		usage.set(e.thingId, { total: u.total + 1, lastAt: Math.max(u.lastAt, e.actualAt) });
	}
	return usage;
};
// Most used first, then most recent, then by title.
export const rankThings = (things, usage) =>
	[...things]
		.sort((a, b) => {
			const ua = usage.get(a.id) ?? { total: 0, lastAt: 0 };
			const ub = usage.get(b.id) ?? { total: 0, lastAt: 0 };
			return (
				ub.total - ua.total ||
				ub.lastAt - ua.lastAt ||
				a.title.localeCompare(b.title) ||
				a.id.localeCompare(b.id)
			);
		})
		.map((t) => t.id);
// things in the frozen order; the ones it doesn't know go last, by title.
export const applyFrozenOrder = (things, order) => {
	const at = new Map(order.map((id, i) => [id, i]));
	const known = things.filter((t) => at.has(t.id)).sort((a, b) => at.get(a.id) - at.get(b.id));
	const rest = things.filter((t) => !at.has(t.id)).sort((a, b) => a.title.localeCompare(b.title));
	return [...known, ...rest];
};
export const sortGroups = (groups) =>
	[...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));

// Track's sections: each group with visible members, then the things no group claims.
// ordered are the visible things in display order.
export const buildRows = (groups, ordered) => {
	const byId = new Map(ordered.map((t) => [t.id, t]));
	const position = new Map(ordered.map((t, i) => [t.id, i]));
	const rows = [];
	const claimed = new Set();
	for (const g of sortGroups(groups)) {
		const members = g.thingIds.filter((id) => byId.has(id));
		for (const id of members) claimed.add(id);
		if (members.length === 0) continue;
		members.sort((a, b) => position.get(a) - position.get(b));
		rows.push({ id: g.id, title: g.title, emoji: g.emoji ?? "", memberIds: members });
	}
	const rest = ordered.filter((t) => !claimed.has(t.id)).map((t) => t.id);
	if (rest.length > 0) rows.push({ id: UNGROUPED, title: "Ungrouped", emoji: "", memberIds: rest });
	return rows;
};

const KEYS = { day: dayKey, week: isoWeekKey, month: monthKey };
const STARTS = { day: startOfDay, week: startOfIsoWeek, month: startOfMonth };
// Buckets newest first, each with its things as chips, most counted first.
export const bucketEvents = (events, granularity, tz) => {
	const buckets = new Map();
	for (const e of events) {
		const key = KEYS[granularity](e.actualAt, tz);
		let b = buckets.get(key);
		if (b === undefined) {
			b = { key, start: STARTS[granularity](e.actualAt, tz), total: 0, things: new Map() };
			buckets.set(key, b);
		}
		const c = b.things.get(e.thingId) ?? { thingId: e.thingId, count: 0, lastAt: 0 };
		b.things.set(e.thingId, { ...c, count: c.count + 1, lastAt: Math.max(c.lastAt, e.actualAt) });
		b.total += 1;
	}
	return [...buckets.values()]
		.map(({ things, ...b }) => ({
			...b,
			end: bucketEnd(b.start, granularity, tz),
			chips: [...things.values()].sort(
				(x, y) => y.count - x.count || y.lastAt - x.lastAt || x.thingId.localeCompare(y.thingId),
			),
		}))
		.sort((a, b) => b.start - a.start);
};
// Day buckets with { gap: days } between days that aren't adjacent.
export const withGaps = (buckets) => {
	const out = [];
	buckets.forEach((b, i) => {
		const prev = buckets[i - 1];
		if (prev !== undefined) {
			const days = Math.round((prev.start + HOUR12 - (b.start + HOUR12)) / DAY) - 1;
			if (days > 0) out.push({ gap: days });
		}
		out.push(b);
	});
	return out;
};
export const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export const countMark = (n) =>
	n <= 1 ? "" : n > 999 ? `×${n}` : [...String(n)].map((d) => SUPERSCRIPT[d]).join("");

// Past values of a thing's measurement, newest first, all positive.
export const measurementHistory = (events, thingId, measurementId) =>
	events
		.filter((e) => e.thingId === thingId)
		.sort((a, b) => b.actualAt - a.actualAt)
		.flatMap((e) => e.measurements.filter((m) => m.measurementId === measurementId))
		.map((m) => m.value)
		.filter((v) => v > 0);

// Bundles, as the pack each one loads.
export const bundlePack = (def) => {
	const things = [];
	const groups = def.groups.map((g, sortOrder) => ({
		id: `group:${def.slug}/${g.slug}`,
		title: g.title,
		emoji: g.emoji,
		description: "",
		sortOrder,
		bundleId: def.slug,
		thingIds: g.things.map((t) => {
			const id = `thing:${def.slug}/${t.slug}`;
			things.push({
				id,
				emoji: t.emoji,
				title: t.title,
				description: "",
				measurements: (t.measures ?? []).map((m) => ({ measurementId: m.slug, unit: m.unit })),
				bundleId: def.slug,
			});
			return id;
		}),
	}));
	const { slug: id, title, description, emoji, version } = def;
	return {
		format: PACK,
		version: 1,
		bundle: { id, title, description, emoji, version },
		groups,
		things,
	};
};
export const BUNDLES = BUNDLE_DEFS.map((def) => {
	const pack = bundlePack(def);
	return {
		...pack.bundle,
		thingCount: pack.things.length,
		groupCount: pack.groups.length,
		pack,
	};
});

// The pack sharing groups: their things, and only those.
export const buildPack = (groups, things, now) => {
	const ids = new Set(groups.flatMap((g) => g.thingIds));
	const included = things.filter((t) => ids.has(t.id));
	const known = new Set(included.map((t) => t.id));
	const narrowed = groups.map((g) => ({
		...g,
		thingIds: g.thingIds.filter((id) => known.has(id)),
	}));
	return { format: PACK, version: 1, exportedAt: now, groups: narrowed, things: included };
};
export const buildBackup = ({ things, groups, events }, now) => {
	const times = events.map((e) => e.actualAt);
	const range = {
		from: times.length === 0 ? null : Math.min(...times),
		to: times.length === 0 ? null : Math.max(...times),
	};
	const counts = {
		things: things.length,
		groups: groups.length,
		events: events.length,
		attachments: 0,
	};
	return { format: BACKUP, version: 1, exportedAt: now, counts, things, groups, events, range };
};

// The envelope in text, or { error } with the app's messages.
export const parseEnvelope = (text) => {
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return { error: "That file isn't JSON." };
	}
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return { error: "That file isn't a Thing Tracker file." };
	}
	if (data.format !== PACK && data.format !== BACKUP) {
		return { error: "That file isn't a Thing Tracker export." };
	}
	if (data.version > 1) {
		return {
			error: `That file was made by a newer version of Thing Tracker (format v${data.version}). Update the app and try again.`,
		};
	}
	for (const key of data.format === PACK ? ["groups", "things"] : ["groups", "things", "events"]) {
		if (!Array.isArray(data[key]))
			return { error: `That file is damaged: expected an array at ${key}.` };
	}
	return { envelope: data };
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// What importing envelope into current ({ things, groups, events }) changes: the lists to
// apply, summary lines and warnings, as the import preview shows them.
export const planImport = (envelope, current, { mode = "merge", overwrite = false } = {}) => {
	const replace = mode === "replace" && envelope.format === BACKUP;
	const base = replace ? { things: [], groups: [], events: [] } : current;
	const things = new Map(base.things.map((t) => [t.id, t]));
	const groups = new Map(base.groups.map((g) => [g.id, g]));
	const eventIds = new Set(base.events.map((e) => e.id));
	const plan = {
		newThings: [],
		updatedThings: [],
		unchanged: 0,
		newGroups: [],
		merges: [],
		newEvents: [],
		skipped: 0,
	};
	const warnings = [];
	for (const t of envelope.things) {
		const local = things.get(t.id);
		if (local === undefined) plan.newThings.push(t);
		else if (
			overwrite ||
			(envelope.format === BACKUP && (t.updatedAt ?? 0) > (local.updatedAt ?? 0))
		) {
			plan.updatedThings.push({ ...local, ...t });
		} else plan.unchanged += 1;
	}
	const known = new Set([...things.keys(), ...plan.newThings.map((t) => t.id)]);
	let sortOrder = Math.max(-1, ...base.groups.map((g) => g.sortOrder));
	for (const g of envelope.groups) {
		const missing = g.thingIds.filter((id) => !known.has(id));
		if (missing.length > 0) {
			warnings.push(
				`“${g.title}” refers to ${plural(missing.length, "thing")} the file doesn't include; they'll be skipped.`,
			);
		}
		const members = g.thingIds.filter((id) => known.has(id));
		const local = groups.get(g.id);
		if (local === undefined) {
			sortOrder += 1;
			plan.newGroups.push({ ...g, thingIds: members, sortOrder });
		} else {
			const added = members.filter((id) => !local.thingIds.includes(id));
			if (added.length > 0) plan.merges.push({ id: g.id, title: local.title, added });
		}
	}
	for (const e of envelope.events ?? []) {
		if (eventIds.has(e.id)) plan.skipped += 1;
		else plan.newEvents.push(e);
	}
	if (replace) {
		const { things: t, groups: g, events: e } = current;
		warnings.unshift(
			`Replaces everything on this device: ${plural(t.length, "thing")}, ${plural(g.length, "tag")} and ${plural(e.length, "entry", "entries")} will be deleted.`,
		);
	}
	const lines = [];
	const line = (n, text) => n > 0 && lines.push(text);
	line(plan.newThings.length, plural(plan.newThings.length, "new thing"));
	line(plan.updatedThings.length, `${plural(plan.updatedThings.length, "thing")} updated`);
	line(plan.unchanged, `${plan.unchanged} already yours`);
	line(plan.newGroups.length, plural(plan.newGroups.length, "new tag"));
	for (const m of plan.merges)
		lines.push(`${plural(m.added.length, "thing")} added to “${m.title}”`);
	line(plan.newEvents.length, `${plural(plan.newEvents.length, "entry", "entries")} restored`);
	line(plan.skipped, `${plural(plan.skipped, "entry", "entries")} already present`);
	const isNoop =
		!replace &&
		plan.newThings.length +
			plan.updatedThings.length +
			plan.newGroups.length +
			plan.merges.length +
			plan.newEvents.length ===
			0;
	if (lines.length === 0) lines.push("Nothing to change — you already have all of this.");
	return {
		...plan,
		replace,
		isNoop,
		lines,
		warnings,
		canOverwrite: plan.unchanged > 0 && envelope.format === PACK,
	};
};
// current with plan applied, as plain records.
export const applyPlan = (plan, current) => {
	const base = plan.replace ? { things: [], groups: [], events: [] } : current;
	const updated = new Map(plan.updatedThings.map((t) => [t.id, t]));
	const things = [...base.things.map((t) => updated.get(t.id) ?? t), ...plan.newThings];
	const merges = new Map(plan.merges.map((m) => [m.id, m.added]));
	const groups = [
		...base.groups.map((g) =>
			merges.has(g.id) ? { ...g, thingIds: [...g.thingIds, ...merges.get(g.id)] } : g,
		),
		...plan.newGroups,
	];
	return { things, groups, events: [...base.events, ...plan.newEvents] };
};
export const importedText = (plan) => {
	const parts = [
		[plan.newThings.length, "thing"],
		[plan.newGroups.length, "tag"],
		[plan.newEvents.length, "entry", "entries"],
	]
		.filter(([n]) => n > 0)
		.map(([n, one, many]) => plural(n, one, many));
	return parts.length === 0 ? "Everything was already here." : `Added ${parts.join(", ")}.`;
};
export const slugify = (s) =>
	normalize(s)
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40) || "untitled";
