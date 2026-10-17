// The app's data as plain records, for backups, imports and the domain functions.
import { findMeasurement, MEASUREMENTS } from "./measure.js";

export const plainThing = ({
	id,
	emoji,
	title,
	description,
	measurements,
	color,
	archived,
	bundleId,
}) => ({
	id,
	emoji,
	title,
	description,
	measurements: measurements.map(({ measurementId, unit }) => ({ measurementId, unit })),
	color,
	archived,
	bundleId,
});
export const plainTag = ({ id, title, emoji, description, sortOrder, thingIds, bundleId }) => ({
	id,
	title,
	emoji,
	description,
	sortOrder,
	thingIds: [...thingIds],
	bundleId,
});
const plainEvent = ({ id, thingId, recordedAt, actualAt, measurements, notes }) => ({
	id,
	thingId,
	recordedAt,
	actualAt,
	measurements: measurements.map(({ measurementId, value }) => ({ measurementId, value })),
	notes,
});
export const snapshotOf = (app) => ({
	things: app.things.map(plainThing),
	groups: app.groups.map(plainTag),
	events: app.events.map(plainEvent),
});
// Records from a file, with the fields our records require.
export const thingFrom = (C, t) =>
	C.Thing({
		id: String(t.id),
		emoji: String(t.emoji ?? "⭐") || "⭐",
		title: String(t.title ?? "").slice(0, 120),
		description: String(t.description ?? ""),
		measurements: (t.measurements ?? [])
			.filter((m) => findMeasurement(MEASUREMENTS, m.measurementId))
			.map(({ measurementId, unit }) => ({ measurementId, unit: unit ?? "" })),
		color: String(t.color ?? ""),
		archived: Boolean(t.archived),
		bundleId: String(t.bundleId ?? ""),
	});
export const tagFrom = (C, g, sortOrder) =>
	C.Tag({
		id: String(g.id),
		title: String(g.title ?? "").slice(0, 120),
		emoji: String(g.emoji ?? ""),
		description: String(g.description ?? ""),
		sortOrder: g.sortOrder ?? sortOrder,
		thingIds: g.thingIds.map(String),
		bundleId: String(g.bundleId ?? ""),
	});
export const eventFrom = (e) => ({
	id: String(e.id),
	thingId: String(e.thingId),
	recordedAt: Math.trunc(e.recordedAt ?? e.actualAt),
	actualAt: Math.trunc(e.actualAt),
	measurements: (e.measurements ?? [])
		.filter((m) => m.value >= 0)
		.map(({ measurementId, value }) => ({ measurementId, value })),
	notes: String(e.notes ?? ""),
});
