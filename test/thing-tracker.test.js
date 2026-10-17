import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { trackerComponents } from "../components/thing-tracker/index.js";
import {
	findMeasurement,
	formatDurationMs,
	formatMeasurement,
	fromBase,
	MEASUREMENTS,
	toBase,
} from "../components/thing-tracker/measure.js";
import {
	applyPlan,
	bucketEvents,
	buildRows,
	countMark,
	filterThings,
	parseEnvelope,
	planImport,
	withGaps,
} from "../components/thing-tracker/model.js";
import { NOW, trackerAppArb } from "../components/thing-tracker/stories.js";
import {
	DAY,
	formatBucketLabel,
	formatRelative,
	fromDatetimeLocal,
	HOUR,
	isoWeekKey,
	startOfIsoWeek,
	toDatetimeLocal,
} from "../components/thing-tracker/time.js";
import { arbitraries, specProperties } from "../src/test/pbt.js";
import { Scope } from "../src/tutuca.js";

const { document } = new JSDOM("").window;

test("relative times and bucket labels", () => {
	assert.deepEqual(
		[10000, 5 * 60000, 3 * HOUR, DAY + HOUR, 3 * DAY, 9 * DAY].map((ago) =>
			formatRelative(NOW - ago, NOW, 0),
		),
		["just now", "5m ago", "3h ago", "yesterday", "3d ago", "7 Oct"],
	);
	assert.equal(formatBucketLabel(NOW - 2 * HOUR - (NOW % DAY), "day", NOW, 0), "Today");
	assert.equal(formatBucketLabel(NOW - DAY - (NOW % DAY), "day", NOW, 0), "Yesterday");
	assert.equal(formatBucketLabel(startOfIsoWeek(NOW, 0), "week", NOW, 0), "12 – 18 Oct");
	assert.equal(formatBucketLabel(NOW, "month", NOW, 0), "October 2026");
	assert.equal(isoWeekKey(NOW, 0), "2026-W42");
});

test("time zones shift days, and datetime-local round trips", () => {
	const late = Date.UTC(2026, 9, 16, 23, 30);
	assert.equal(formatBucketLabel(late - (late % DAY), "day", late, 0), "Today");
	assert.equal(toDatetimeLocal(late, 120), "2026-10-17T01:30");
	fc.assert(
		fc.property(fc.integer({ min: 0, max: 4e12 }), fc.constantFrom(0, 60, -300, 330), (ts, tz) => {
			const minute = ts - (ts % 60000);
			assert.equal(fromDatetimeLocal(toDatetimeLocal(minute, tz), tz), minute);
		}),
	);
	assert.equal(fromDatetimeLocal("not a date", 0), null);
});

test("measurements convert and format", () => {
	const temp = findMeasurement(MEASUREMENTS, "temperature");
	const f = temp.units.find((u) => u.id === "f");
	assert.ok(Math.abs(toBase(212, f) - 100) < 1e-9);
	assert.equal(formatMeasurement(temp, 37, "f"), "98.6°F");
	assert.deepEqual([0, 90000, 4 * 60000 + 30000, 95 * 60000, 26 * HOUR].map(formatDurationMs), [
		"0m",
		"1m 30s",
		"4m 30s",
		"1h 35m",
		"1d 2h",
	]);
	fc.assert(
		fc.property(
			fc.constantFrom(...MEASUREMENTS),
			fc.double({ min: 0, max: 1e6, noNaN: true }),
			(m, v) => {
				for (const u of m.units)
					assert.ok(Math.abs(fromBase(toBase(v, u), u) - v) < 1e-6 * Math.max(1, v));
			},
		),
	);
});

test("search ranks titles over descriptions and needs every term", () => {
	const things = [
		{ id: "a", emoji: "☕", title: "Coffee", description: "" },
		{ id: "b", emoji: "🍵", title: "Tea", description: "not coffee" },
		{ id: "c", emoji: "🥤", title: "Iced coffee", description: "" },
	];
	assert.deepEqual(
		filterThings(things, "coffee").map((t) => t.id),
		["a", "c", "b"],
	);
	assert.deepEqual(
		filterThings(things, "iced coffee").map((t) => t.id),
		["c"],
	);
	assert.deepEqual(
		filterThings(things, "🍵").map((t) => t.id),
		["b"],
	);
});

test("rows: tags in order, then the ungrouped", () => {
	const things = ["a", "b", "c"].map((id) => ({ id }));
	const groups = [
		{ id: "g2", title: "B", sortOrder: 1, thingIds: ["b"] },
		{ id: "g1", title: "A", sortOrder: 0, thingIds: ["c", "a", "gone"] },
		{ id: "g3", title: "Empty", sortOrder: 2, thingIds: [] },
	];
	assert.deepEqual(
		buildRows(groups, things).map((r) => [r.id, r.memberIds]),
		[
			["g1", ["a", "c"]],
			["g2", ["b"]],
		],
	);
	assert.deepEqual(
		buildRows([], things).map((r) => r.title),
		["Ungrouped"],
	);
});

test("buckets count per thing and leave gaps between days", () => {
	const events = [
		{ thingId: "a", actualAt: NOW },
		{ thingId: "a", actualAt: NOW - HOUR },
		{ thingId: "b", actualAt: NOW - 2 * HOUR },
		{ thingId: "a", actualAt: NOW - 4 * DAY },
	];
	const days = withGaps(bucketEvents(events, "day", 0));
	assert.deepEqual(
		days.map((b) => b.gap ?? b.total),
		[3, 3, 1],
	);
	assert.deepEqual(
		days[0].chips.map((c) => [c.thingId, c.count]),
		[
			["a", 2],
			["b", 1],
		],
	);
	assert.deepEqual([1, 2, 12, 1000].map(countMark), ["", "²", "¹²", "×1000"]);
});

test("imports: errors, merges and replaces", () => {
	assert.equal(parseEnvelope("{").error, "That file isn't JSON.");
	assert.equal(parseEnvelope("[]").error, "That file isn't a Thing Tracker file.");
	assert.equal(parseEnvelope('{"format":"x"}').error, "That file isn't a Thing Tracker export.");
	assert.match(parseEnvelope('{"format":"thing-tracker/backup","version":3}').error, /format v3/);
	const current = {
		things: [{ id: "a", title: "A" }],
		groups: [{ id: "g", title: "G", sortOrder: 0, thingIds: ["a"] }],
		events: [{ id: "e1", thingId: "a" }],
	};
	const pack = {
		format: "thing-tracker/group-pack",
		things: [
			{ id: "a", title: "A2" },
			{ id: "b", title: "B" },
		],
		groups: [{ id: "g", title: "Other", thingIds: ["a", "b", "missing"] }],
	};
	const plan = planImport(pack, current);
	assert.deepEqual(plan.lines, ["1 new thing", "1 already yours", "1 thing added to “G”"]);
	assert.match(plan.warnings[0], /refers to 1 thing the file doesn't include/);
	const next = applyPlan(plan, current);
	assert.deepEqual(next.groups[0].thingIds, ["a", "b"]);
	assert.equal(next.things[0].title, "A");
	assert.equal(
		applyPlan(planImport(pack, current, { overwrite: true }), current).things[0].title,
		"A2",
	);
	const again = planImport(pack, next);
	assert.ok(again.isNoop);
	const backup = {
		format: "thing-tracker/backup",
		things: [],
		groups: [],
		events: [{ id: "e1", thingId: "a" }],
	};
	assert.deepEqual(planImport(backup, current).lines, ["1 entry already present"]);
	assert.ok(planImport(backup, current, { mode: "replace" }).replace);
});

for (const [name, spec] of Object.entries(trackerComponents)) {
	test(`${name} has the generic properties`, () => {
		const scope = new Scope(() => {});
		scope.register(trackerComponents);
		const A = arbitraries({ fc, scope, overrides: { TrackerApp: trackerAppArb } });
		for (const [propName, prop] of Object.entries(specProperties(spec, A, { document }))) {
			try {
				fc.assert(prop, { numRuns: 20 });
			} catch (error) {
				error.message = `${name}.${propName}: ${error.message}`;
				throw error;
			}
		}
	});
}
