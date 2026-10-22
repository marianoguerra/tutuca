// A port of the UI of thing-tracker (github.com/marianoguerra/thing-tracker): tap an emoji
// to log a thing, see what you did by day, week or month, manage things, tags, bundles and
// backups. The app owns all data; panels and children notify it with what to change.
// Time is state (now, tz) the host keeps current, so every view is a function of it.

import {
	$if,
	button,
	component,
	each,
	field,
	render,
	scopeOf,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import {
	eventRecord,
	ICON_TOGGLE,
	INTERVALS,
	LINK,
	MANAGE_TABS,
	MUTED,
	measureRef,
	PANELS,
	pick,
	seg,
	TABS,
} from "./common.js";
import { EmojiPicker } from "./emoji-picker.js";
import { findMeasurement, formatMeasurement, MEASUREMENTS, preferredUnit } from "./measure.js";
import {
	applyFrozenOrder,
	applyPlan,
	BUNDLES,
	bucketEvents,
	buildBackup,
	buildPack,
	buildRows,
	countMark,
	filterThings,
	importedText,
	matchesQuery,
	measurementHistory,
	parseEnvelope,
	planImport,
	plural,
	rankThings,
	slugify,
	UNGROUPED,
	usageOf,
	withGaps,
} from "./model.js";
import { EntryList } from "./panels/entry-list.js";
import { EventEditor } from "./panels/event-editor.js";
import { MeasurementWizard } from "./panels/measurement-wizard.js";
import { TagEditor } from "./panels/tag-editor.js";
import { ThingEditor } from "./panels/thing-editor.js";
import { makePrompt, Prompt } from "./prompt.js";
import { eventFrom, plainTag, plainThing, snapshotOf, tagFrom, thingFrom } from "./records.js";
import { Bucket, Section, Tag, Thing } from "./rows.js";
import {
	DAY,
	dayKey,
	daysAgo,
	formatBucketLabel,
	formatDate,
	formatRelative,
	formatTime,
	toDatetimeLocal,
} from "./time.js";
import { importDialog, insightsView, manageView, trackView } from "./views.js";

const { div, li, main, nav, span, ul } = tag;

// Rebuilds what the app derives from its data and time: thing stats, Track's sections,
// Insights' buckets and an open entry list.
const refresh = (self, next) => {
	const C = scopeOf(self).components;
	const { now, tz } = next;
	const usage = usageOf(next.events);
	const tagsOf = new Map();
	for (const g of next.groups)
		for (const id of g.thingIds) tagsOf.set(id, [...(tagsOf.get(id) ?? []), g.title]);
	for (const thing of next.things) {
		const u = usage.get(thing.id);
		thing.total = u?.total ?? 0;
		thing.lastText = u === undefined ? "never" : formatRelative(u.lastAt, now, tz);
		thing.tagsText = tagsOf.get(thing.id)?.join(" · ") ?? "No tags";
	}
	const visible = next.things.filter((thing) => !thing.archived);
	const searching = next.query.trim() !== "";
	const ordered = searching
		? filterThings(visible, next.query)
		: applyFrozenOrder(visible, next.order);
	next.sections = buildRows(next.groups, ordered).map((row) =>
		C.Section({
			...row,
			isOpen: searching || !next.collapsed.includes(row.id),
			compact: next.compact,
		}),
	);
	const group = next.groups.find((g) => g.id === next.groupFilter);
	const events =
		group === undefined
			? next.events
			: next.events.filter((e) => group.thingIds.includes(e.thingId));
	const buckets = bucketEvents(events, next.granularity, tz);
	const thingOf = new Map(next.things.map((thing) => [thing.id, thing]));
	next.buckets = (next.granularity === "day" ? withGaps(buckets) : buckets).map((b) =>
		b.gap !== undefined
			? C.Bucket({ gap: b.gap })
			: C.Bucket({
					label: formatBucketLabel(b.start, next.granularity, now, tz),
					start: b.start,
					end: b.end,
					total: b.total,
					chips: b.chips.map((c) => {
						const thing = thingOf.get(c.thingId);
						const title = thing?.title ?? "Deleted thing";
						return {
							thingId: c.thingId,
							emoji: thing?.emoji ?? "❔",
							aria: `${title}, ${plural(c.count, "time")}`,
							tip: `${title} · ${c.count}`,
							mark: countMark(c.count),
						};
					}),
				}),
	);
	if (next.listContext !== null) refreshList(next, thingOf);
};
const entryLine = (e, tz, mixed, thing) => {
	const values = e.measurements.map((m) => {
		const measurement = findMeasurement(MEASUREMENTS, m.measurementId);
		return measurement === undefined ? "" : ` · ${formatMeasurement(measurement, m.value)}`;
	});
	return {
		id: e.id,
		head: mixed ? `${thing?.emoji ?? "❔"} ${thing?.title ?? "Deleted thing"}` : "",
		line: `${formatDate(e.actualAt, tz)} · ${formatTime(e.actualAt, tz)}${values.join("")}`,
		notes: e.notes,
		recorded:
			Math.abs(e.recordedAt - e.actualAt) > 60000 ? `recorded ${formatTime(e.recordedAt, tz)}` : "",
	};
};
const refreshList = (next, thingOf) => {
	if (next.panel?.rows === undefined) {
		next.listContext = null;
		return;
	}
	const ctx = next.listContext;
	const group = next.groups.find((g) => g.id === next.groupFilter);
	const all = next.events
		.filter((e) =>
			ctx.thingId === ""
				? group === undefined || group.thingIds.includes(e.thingId)
				: e.thingId === ctx.thingId && e.actualAt >= ctx.start && e.actualAt < ctx.end,
		)
		.sort((a, b) => b.actualAt - a.actualAt);
	const shown = ctx.thingId === "" ? all.slice(0, next.shownEntries) : all;
	const mixed = ctx.thingId === "";
	next.panel.rows = shown.map((e) => entryLine(e, next.tz, mixed, thingOf.get(e.thingId)));
	next.panel.remaining = all.length - shown.length;
	if (mixed) next.panel.subtitle = `${shown.length} of ${all.length}, newest first`;
};
// Shows a toast, gone after a while unless another replaces it first.
const toast = (next, ctx, title, text, { eventId = "", kind = "info" } = {}) => {
	next.toastSeq += 1;
	next.toast = { id: next.toastSeq, title, text, eventId, kind };
	ctx.ask("wait", [4000, next.toastSeq]);
};
const newId = (ctx, prefix) => `${prefix}-${ctx.uuid()}`;
const openImport = (next, ctx, title, text) => {
	const parsed = parseEnvelope(text);
	if (parsed.error !== undefined) {
		toast(next, ctx, "Couldn't read that file", parsed.error, { kind: "error" });
		return;
	}
	next.importSource = text;
	next.importTitle =
		title ||
		(parsed.envelope.format === "thing-tracker/backup"
			? "Restore backup"
			: (parsed.envelope.bundle?.title ?? "Import tags"));
	next.overwrite = false;
	next.showPreview = true;
};

export const TrackerApp = component({
	name: "TrackerApp",
	fields: {
		now: t.number().int().min(0),
		tz: t.number().int().min(-840).max(840),
		tab: t.enum("track", "insights", "manage"),
		things: t.array(t.component("Thing")),
		groups: t.array(t.component("Tag")),
		events: t.array(eventRecord()),
		order: t.array(t.string()),
		collapsed: t.array(t.string()),
		query: t.string().sync("none"),
		compact: t.boolean(),
		sections: t.array(t.component("Section")),
		granularity: t.enum("day", "week", "month"),
		groupFilter: t.string(),
		buckets: t.array(t.component("Bucket")),
		shownEntries: t.number(200).int().min(1),
		listContext: t.option(t.record({ thingId: t.string(), start: t.number(), end: t.number() })),
		manageTab: t.enum(...MANAGE_TABS.map(([id]) => id)),
		manageQuery: t.string().sync("none"),
		panel: t.option(t.component(PANELS)),
		toast: t.option(
			t.record({
				id: t.number().int(),
				title: t.string(),
				text: t.string(),
				eventId: t.string(),
				kind: t.enum("info", "logged", "error"),
			}),
		),
		toastSeq: t.number().int().min(0),
		hintShown: t.boolean(),
		backup: t.record({
			lastAt: t.number().min(0), // 0 when never.
			intervalDays: t.enum(7, 1, 3, 14, 30, 90, 0),
			dismissedAt: t.number().min(0),
			rangeText: t.string(),
		}),
		importMode: t.enum("merge", "replace"),
		importText: t.string().sync("none"),
		importSource: t.string().sync("none"),
		importTitle: t.string().sync("none"),
		showPreview: t.boolean().sync("none"),
		overwrite: t.boolean().sync("none"),
	},
	invariants: {
		statsMatchEvents() {
			const usage = usageOf(this.events);
			return this.things.every((thing) => thing.total === (usage.get(thing.id)?.total ?? 0));
		},
		eventsKnowTheirThing() {
			const ids = new Set(this.things.map((thing) => thing.id));
			return this.events.every((e) => ids.has(e.thingId));
		},
		uniqueIds() {
			const ids = [...this.things, ...this.groups, ...this.events].map((x) => x.id);
			return new Set(ids).size === ids.length;
		},
	},
	provides: {
		things(b) {
			b.field("things");
		},
	},
	methods: {
		snapshot() {
			return snapshotOf(this);
		},
		get isTrack() {
			return this.tab === "track";
		},
		get isInsights() {
			return this.tab === "insights";
		},
		get isManage() {
			return this.tab === "manage";
		},
		get tabButtons() {
			return TABS.map(([id, icon, text]) => ({
				id,
				icon,
				text,
				cls: `flex h-full w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium ${id === this.tab ? "" : MUTED}`,
				current: id === this.tab ? "page" : "false",
			}));
		},
		get hasPanel() {
			return this.panel !== null;
		},
		// Track.
		get hasThings() {
			return this.things.some((thing) => !thing.archived);
		},
		get searching() {
			return this.query.trim() !== "";
		},
		get noMatches() {
			return this.hasThings && this.sections.length === 0;
		},
		get noMatchText() {
			return `Nothing matches “${this.query.trim()}”.`;
		},
		get createText() {
			return `Create “${this.query.trim()}”`;
		},
		get anyOpen() {
			return this.sections.some((s) => s.isOpen);
		},
		get collapseLabel() {
			return this.anyOpen ? "Collapse all sections" : "Expand all sections";
		},
		get collapseIcon() {
			return this.anyOpen ? "⇡" : "⇣";
		},
		get compactClass() {
			return this.compact
				? `${ICON_TOGGLE} border-transparent bg-primary text-primary-content`
				: `${ICON_TOGGLE} border-base-300 ${MUTED}`;
		},
		get compactLabel() {
			return this.compact ? "Show labels" : "Hide labels";
		},
		get gridView() {
			return this.compact ? "compact" : "main";
		},
		get backupDue() {
			const { intervalDays, lastAt, dismissedAt } = this.backup;
			if (intervalDays === 0) return false;
			const interval = intervalDays * DAY;
			if (dismissedAt > 0 && this.now - dismissedAt < interval) return false;
			return lastAt === 0 || this.now - lastAt >= interval;
		},
		get backupTitle() {
			return this.backup.lastAt === 0 ? "You haven't backed up yet" : "Time for a backup";
		},
		get backupText() {
			return this.backup.lastAt === 0
				? "Everything you've logged lives only in this browser. One file keeps it safe."
				: `Your last backup was ${daysAgo(this.backup.lastAt, this.now)}.`;
		},
		get hasToast() {
			return this.toast !== null;
		},
		get toastCanEdit() {
			return this.toast?.kind === "logged";
		},
		get toastTitle() {
			return this.toast?.title ?? "";
		},
		get toastText() {
			return this.toast?.text ?? "";
		},
		get toastClass() {
			return this.toast?.kind === "error"
				? "flex items-start gap-3 rounded-lg border border-error/40 bg-base-100 p-3 text-sm shadow-lg"
				: "flex items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-sm shadow-lg";
		},
		// Insights.
		get granularityButtons() {
			return ["day", "week", "month"].map((g) => ({
				value: g,
				text: g[0].toUpperCase() + g.slice(1),
				cls:
					g === this.granularity
						? "flex-1 rounded-md px-3 py-1.5 bg-base-100 shadow-sm"
						: `flex-1 rounded-md px-3 py-1.5 ${MUTED}`,
			}));
		},
		get hasUsedGroups() {
			const ids = new Set(this.things.map((thing) => thing.id));
			return this.groups.some((g) => g.thingIds.some((id) => ids.has(id)));
		},
		get allChipClass() {
			return pick(this.groupFilter === "");
		},
		get noEvents() {
			return this.buckets.length === 0;
		},
		// Manage.
		get manageTabs() {
			return MANAGE_TABS.map(([id, text]) => ({ id, text, cls: seg(id === this.manageTab) }));
		},
		get isThingsTab() {
			return this.manageTab === "things";
		},
		get isGroupsTab() {
			return this.manageTab === "groups";
		},
		get isUnitsTab() {
			return this.manageTab === "units";
		},
		get isBundlesTab() {
			return this.manageTab === "bundles";
		},
		get isDataTab() {
			return this.manageTab === "data";
		},
		get manageNoMatch() {
			return `Nothing matches “${this.manageQuery.trim()}”.`;
		},
		get thingsEmpty() {
			return this.things.length === 0;
		},
		get groupsEmpty() {
			return this.groups.length === 0;
		},
		get unitRows() {
			return [...MEASUREMENTS]
				.filter((m) =>
					matchesQuery(
						[m.name, m.emoji, ...m.units.flatMap((u) => [u.label, u.symbol])],
						this.manageQuery,
					),
				)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((m) => {
					const n = this.things.filter((thing) =>
						thing.measurements.some((r) => r.measurementId === m.id),
					).length;
					return {
						emoji: m.emoji,
						name: m.name,
						usage: n === 0 ? "unused" : plural(n, "thing"),
						units: m.units.map((u) => u.symbol.trim() || u.label).join(" · "),
					};
				});
		},
		get bundleCards() {
			return BUNDLES.filter((b) =>
				matchesQuery([b.title, b.description, b.emoji], this.manageQuery),
			).map((b) => {
				const added = this.things.some((thing) => thing.bundleId === b.id);
				return {
					id: b.id,
					emoji: b.emoji,
					title: b.title,
					description: b.description,
					counts: `${b.thingCount} things · ${plural(b.groupCount, "tag")}`,
					added,
					action: added ? "Re-check" : "Add",
					cls: added ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm",
				};
			});
		},
		get countsText() {
			return `${this.things.length} things · ${this.groups.length} tags · ${this.events.length} entries`;
		},
		get backupStatus() {
			const { lastAt, rangeText } = this.backup;
			if (lastAt === 0) return "No backup made yet.";
			return `Last backup ${daysAgo(lastAt, this.now)}${rangeText ? `, covering ${rangeText}` : ""}.`;
		},
		get intervalChips() {
			return INTERVALS.map(([days, text]) => ({
				value: String(days),
				text,
				cls: pick(days === this.backup.intervalDays),
			}));
		},
		get modeButtons() {
			return ["merge", "replace"].map((mode) => ({
				value: mode,
				text: mode === "merge" ? "Merge" : "Replace",
				cls:
					mode === this.importMode
						? "flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-content"
						: "flex-1 rounded-md border border-base-300 px-3 py-1.5 text-sm font-medium",
			}));
		},
		get modeText() {
			return this.importMode === "merge"
				? "Keeps what's here and adds what's missing. Entries are never duplicated."
				: "Deletes everything on this device first. Only applies to full backups.";
		},
		get plan() {
			const parsed = parseEnvelope(this.importSource);
			if (parsed.error !== undefined) return null;
			return planImport(parsed.envelope, this.snapshot(), {
				mode: this.importMode,
				overwrite: this.overwrite,
			});
		},
		get preview() {
			const plan = this.plan;
			if (plan === null)
				return {
					lines: [],
					warnings: [],
					description: "",
					isNoop: true,
					canOverwrite: false,
					replace: false,
				};
			const description = plan.isNoop
				? "You already have every thing in this file."
				: "Here's what will change on this device.";
			return { ...plan, description };
		},
		get previewLines() {
			return this.preview.lines;
		},
		get previewWarnings() {
			return this.preview.warnings;
		},
		get previewDescription() {
			return this.preview.description;
		},
		get previewNoop() {
			return this.preview.isNoop;
		},
		get previewCanOverwrite() {
			return this.preview.canOverwrite;
		},
		get confirmImportLabel() {
			return this.preview.replace ? "Replace everything" : "Import";
		},
		get confirmImportClass() {
			return this.preview.replace ? "btn btn-error btn-sm" : "btn btn-primary btn-sm";
		},
	},
	loops: {
		usedGroups: {
			*iter(items) {
				const ids = new Set(this.things.map((thing) => thing.id));
				const used = [...items.entries()].filter(([, g]) => g.thingIds.some((id) => ids.has(id)));
				yield* used.sort(
					([, a], [, b]) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
				);
			},
			enrich({ value }) {
				return { chip: pick(value.id === this.groupFilter) };
			},
		},
		manageThings: {
			view: "row",
			*iter(items) {
				const entries = [...items.entries()];
				if (this.manageQuery.trim() !== "") {
					const kept = filterThings(items, this.manageQuery);
					yield* kept.map((thing) => entries.find(([, x]) => x === thing));
				} else yield* entries.sort(([, a], [, b]) => a.title.localeCompare(b.title));
			},
		},
		manageGroups: {
			view: "row",
			*iter(items) {
				const kept = [...items.entries()].filter(([, g]) =>
					matchesQuery([g.title, g.description, g.emoji], this.manageQuery),
				);
				yield* kept.sort(
					([, a], [, b]) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
				);
			},
		},
	},
	view: div(
		{
			class:
				"relative mx-auto flex min-h-[40rem] w-full max-w-2xl flex-col overflow-hidden bg-base-100 text-base-content",
		},
		main(
			{ class: "min-h-0 flex-1 overflow-y-auto pb-20" },
			trackView(),
			insightsView(),
			manageView(),
		),
		nav(
			{
				class:
					"absolute inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100/85 backdrop-blur-lg",
			},
			ul(
				{ class: "mx-auto flex h-16 max-w-2xl" },
				each(
					field("tabButtons"),
					li(
						{ class: "flex-1" },
						button(
							{
								class: field("cls"),
								"aria-current": field("current"),
								value: field("id"),
								"on:click": send("setTab", targetValue()),
							},
							span({ class: "text-lg leading-none" }, field("icon")),
							field("text"),
						),
					),
				),
			),
		),
		$if(
			field("hasToast"),
			div(
				{ class: "absolute inset-x-0 bottom-20 z-30 flex justify-center px-4", role: "status" },
				div(
					{ class: field("toastClass") },
					div(
						{ class: "min-w-0 flex-1" },
						div({ class: "font-medium" }, field("toastTitle")),
						div(
							{ class: `text-xs ${MUTED}` },
							field("toastText"),
							$if(
								field("toastCanEdit"),
								button({ class: `ml-1 ${LINK}`, "on:click": send("editToast") }, "Edit"),
								"",
							),
						),
					),
					$if(
						field("toastCanEdit"),
						button({ class: "btn btn-xs", "on:click": send("undoToast") }, "Undo"),
						"",
					),
					button(
						{
							class: "btn btn-ghost btn-xs",
							"aria-label": "Dismiss",
							"on:click": send("dismissToast"),
						},
						"✕",
					),
				),
			),
			"",
		),
		$if(field("showPreview"), importDialog(), ""),
		$if(field("hasPanel"), render(field("panel")), ""),
	),
	on: {
		setTab: {
			args: [t.string()],
			run(next, [tab]) {
				if (TABS.some(([id]) => id === tab)) next.tab = tab;
			},
		},
		// Time: the host asks for it, or sends it.
		syncNow: {
			args: [],
			emits: { ask: ["now"] },
			run(_next, _args, ctx) {
				ctx.ask("now");
			},
		},
		nowReplyOk(next, [now]) {
			if (!Number.isInteger(now) || now < 0) return;
			next.now = now;
			refresh(this, next);
		},
		nowReplyError() {},
		nowHandlerNotFound() {},
		setNow: {
			args: [t.number().int().min(0)],
			run(next, [now]) {
				next.now = now;
				refresh(this, next);
			},
		},
		// Re-sorts Track by use; the original does it when the app comes back to the front.
		reorder: {
			args: [],
			run(next) {
				next.order = rankThings(
					this.things.filter((thing) => !thing.archived),
					usageOf(this.events),
				);
				refresh(this, next);
			},
		},
		// Track.
		setQuery: {
			args: [t.string()],
			run(next, [query]) {
				next.query = query;
				refresh(this, next);
			},
		},
		toggleCompact: {
			args: [],
			run(next) {
				next.compact = !this.compact;
				refresh(this, next);
			},
		},
		toggleSection: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				if (this.searching) return;
				next.collapsed = this.collapsed.includes(id)
					? this.collapsed.filter((c) => c !== id)
					: [...this.collapsed, id];
				refresh(this, next);
			},
		},
		// Collapses all when any is open, else expands all; keeps ids not on screen.
		toggleAllSections: {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				const ids = this.sections.map((s) => s.id);
				next.collapsed = this.anyOpen
					? [...new Set([...this.collapsed, ...ids])]
					: this.collapsed.filter((id) => !ids.includes(id));
				refresh(this, next);
			},
		},
		logThing: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === id);
				if (thing === undefined) return;
				const C = ctx.scope.components;
				const prompts = thing.measurements.flatMap((ref) => {
					const m = findMeasurement(MEASUREMENTS, ref.measurementId);
					if (m === undefined) return [];
					const history = measurementHistory(this.events, thing.id, m.id);
					const u = preferredUnit(m, ref.unit);
					return [makePrompt(C, m, ref.unit, history[0] ?? u.factor, history)];
				});
				if (prompts.length === 0) logEvent(this, next, ctx, thing, []);
				else
					next.panel = C.MeasurementWizard({
						thingId: thing.id,
						emoji: thing.emoji,
						title: thing.title,
						prompts,
					});
			},
		},
		commitLog: {
			args: [
				t.string(),
				t.array(t.record({ measurementId: t.string(), value: t.number().min(0) })),
			],
			run(next, [thingId, values], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === thingId);
				next.panel = null;
				if (thing !== undefined) logEvent(this, next, ctx, thing, values);
			},
		},
		// Opens the editor on an unsaved entry for now, with last time's values.
		backdateThing: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === id);
				if (thing === undefined) return;
				const C = ctx.scope.components;
				const values = thing.measurements.flatMap((ref) => {
					const m = findMeasurement(MEASUREMENTS, ref.measurementId);
					if (m === undefined) return [];
					const history = measurementHistory(this.events, thing.id, m.id);
					return [makePrompt(C, m, ref.unit, history[0] ?? 0, history, true)];
				});
				next.panel = C.EventEditor({
					mode: "create",
					thingId: thing.id,
					heading: `${thing.emoji} ${thing.title}`,
					subtitle: "Set when this happened.",
					recordedAt: this.now,
					when: toDatetimeLocal(this.now, this.tz),
					tz: this.tz,
					values,
				});
			},
		},
		saveEntry: {
			args: [
				t.record({
					mode: t.enum("create", "edit"),
					id: t.string(),
					thingId: t.string(),
					recordedAt: t.number().int(),
					actualAt: t.number().int(),
					notes: t.string(),
					measurements: t.array(t.record({ measurementId: t.string(), value: t.number().min(0) })),
				}),
			],
			run(next, [entry], ctx) {
				ctx.stopNext();
				const { mode, id, thingId, recordedAt, actualAt, notes, measurements } = entry;
				if (mode === "create" && !this.things.some((x) => x.id === thingId)) return;
				const record = {
					thingId,
					recordedAt,
					actualAt,
					notes: notes.trim() ? notes : "",
					measurements,
				};
				if (mode === "create") next.events.push({ id: newId(ctx, "event"), ...record });
				else {
					const e = next.events.find((x) => x.id === id);
					if (e !== undefined)
						Object.assign(e, {
							actualAt,
							notes: record.notes,
							measurements: measurements.filter((m) => m.value > 0),
						});
				}
				next.panel = null;
				next.listContext = null;
				refresh(this, next);
			},
		},
		editEntry: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				openEntry(this, next, id);
			},
		},
		deleteEntry: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				next.events = next.events.filter((e) => e.id !== id);
				if (this.panel?.eventId === id) next.panel = null;
				refresh(this, next);
			},
		},
		closePanel(next, _args, ctx) {
			ctx.stopNext();
			next.panel = null;
			next.listContext = null;
		},
		// Toasts.
		undoToast: {
			args: [],
			run(next) {
				const id = this.toast?.eventId;
				next.toast = null;
				if (!id) return;
				next.events = next.events.filter((e) => e.id !== id);
				refresh(this, next);
			},
		},
		editToast: {
			args: [],
			run(next) {
				const id = this.toast?.eventId;
				next.toast = null;
				if (id) openEntry(this, next, id);
			},
		},
		dismissToast: {
			args: [],
			run(next) {
				next.toast = null;
			},
		},
		// A toast's timer ran out; the first log's is followed by a tip.
		waitReplyOk(next, [id], ctx) {
			if (this.toast?.id !== id) return;
			next.toast = null;
			if (!this.hintShown && this.toast.kind === "logged") {
				next.hintShown = true;
				toast(
					next,
					ctx,
					"Tip",
					"Press and hold a thing to log it at a different time, or a section header to collapse everything.",
				);
				ctx.ask("wait", [6000, next.toastSeq]);
			}
		},
		waitReplyError() {},
		waitHandlerNotFound() {},
		// Insights.
		setGranularity: {
			args: [t.string()],
			run(next, [granularity]) {
				if (!["day", "week", "month"].includes(granularity)) return;
				next.granularity = granularity;
				refresh(this, next);
			},
		},
		setGroupFilter: {
			args: [t.index("groups")],
			run(next, [i]) {
				const { id } = this.groups[i];
				next.groupFilter = id === this.groupFilter ? "" : id;
				refresh(this, next);
			},
		},
		clearGroupFilter: {
			args: [],
			run(next) {
				next.groupFilter = "";
				refresh(this, next);
			},
		},
		openChip: {
			args: [t.string(), t.number(), t.number(), t.string()],
			run(next, [thingId, start, end, bucketLabel], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === thingId);
				const C = ctx.scope.components;
				next.panel = C.EntryList({
					heading: thing === undefined ? "❔ Deleted thing" : `${thing.emoji} ${thing.title}`,
					subtitle: bucketLabel,
				});
				next.listContext = { thingId, start, end };
				refresh(this, next);
			},
		},
		openAllEntries: {
			args: [],
			run(next, _args, ctx) {
				next.shownEntries = 200;
				next.panel = ctx.scope.components.EntryList({ heading: "All entries" });
				next.listContext = { thingId: "", start: 0, end: 0 };
				refresh(this, next);
			},
		},
		moreEntries(next, _args, ctx) {
			ctx.stopNext();
			next.shownEntries = this.shownEntries + 200;
			refresh(this, next);
		},
		// Things.
		newThing: {
			args: [t.string()],
			run(next, [title], ctx) {
				const C = ctx.scope.components;
				next.panel = C.ThingEditor({ mode: "create", title, pickerOpen: true });
			},
		},
		newThingFromQuery: {
			args: [],
			run(next, _args, ctx) {
				const C = ctx.scope.components;
				next.panel = C.ThingEditor({ mode: "create", title: this.query.trim(), pickerOpen: true });
			},
		},
		editThing: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === id);
				if (thing === undefined) return;
				const C = ctx.scope.components;
				// The same emoji as a thing sharing one of its tags.
				const peers = this.groups
					.filter((g) => g.thingIds.includes(thing.id))
					.flatMap((g) => g.thingIds);
				const other = this.things.find(
					(x) => x.id !== thing.id && x.emoji === thing.emoji && peers.includes(x.id),
				);
				next.panel = C.ThingEditor({
					mode: "edit",
					thingId: thing.id,
					emoji: thing.emoji,
					title: thing.title,
					description: thing.description,
					measurements: thing.measurements.map((r) => ({ ...r })),
					clash:
						other === undefined
							? ""
							: `${thing.emoji} is already used by ${other.title} in one of the same groups — still fine, just harder to tell apart at a glance.`,
				});
			},
		},
		saveThing: {
			args: [
				t.enum("create", "edit"),
				t.record({
					id: t.string(),
					emoji: t.string().len(1, 16),
					title: t.string().len(0, 120),
					description: t.string(),
					measurements: t.array(measureRef()),
				}),
			],
			run(next, [mode, thing], ctx) {
				ctx.stopNext();
				const C = ctx.scope.components;
				if (mode === "create") {
					const id = newId(ctx, "thing");
					next.things.push(C.Thing({ ...thing, id }));
					next.order.push(id);
				} else {
					const local = next.things.find((x) => x.id === thing.id);
					if (local !== undefined) {
						Object.assign(local, {
							emoji: thing.emoji,
							title: thing.title,
							description: thing.description,
							measurements: thing.measurements,
						});
					}
				}
				next.panel = null;
				refresh(this, next);
			},
		},
		// Its entries go too, and it leaves every tag.
		deleteThing: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				next.events = next.events.filter((e) => e.thingId !== id);
				for (const g of next.groups)
					if (g.thingIds.includes(id)) g.thingIds = g.thingIds.filter((x) => x !== id);
				next.things = next.things.filter((x) => x.id !== id);
				next.panel = null;
				refresh(this, next);
			},
		},
		// Tags.
		newTag: {
			args: [],
			run(next) {
				openTagEditor(this, next, null);
			},
		},
		editTag: {
			args: [],
			sourceKey: t.index("groups"),
			run(next, _args, ctx) {
				ctx.stopNext();
				openTagEditor(this, next, this.groups[ctx.sourceKey]);
			},
		},
		saveTag: {
			args: [
				t.enum("create", "edit"),
				t.record({
					id: t.string(),
					title: t.string().len(0, 120),
					emoji: t.string(),
					thingIds: t.array(t.string()),
				}),
			],
			run(next, [mode, given], ctx) {
				ctx.stopNext();
				const C = ctx.scope.components;
				const known = new Set(this.things.map((x) => x.id));
				const tag = { ...given, thingIds: given.thingIds.filter((id) => known.has(id)) };
				if (mode === "create") {
					const sortOrder = Math.max(-1, ...this.groups.map((g) => g.sortOrder)) + 1;
					next.groups.push(C.Tag({ ...tag, id: newId(ctx, "tag"), sortOrder }));
				} else {
					const local = next.groups.find((g) => g.id === tag.id);
					if (local !== undefined)
						Object.assign(local, { title: tag.title, emoji: tag.emoji, thingIds: tag.thingIds });
				}
				next.panel = null;
				refresh(this, next);
			},
		},
		deleteTag: {
			args: [t.string()],
			run(next, [id], ctx) {
				ctx.stopNext();
				next.groups = next.groups.filter((g) => g.id !== id);
				if (this.groupFilter === id) next.groupFilter = "";
				next.panel = null;
				refresh(this, next);
			},
		},
		shareTag: {
			args: [],
			sourceKey: t.index("groups"),
			emits: { ask: ["saveFile"] },
			run(_next, _args, ctx) {
				ctx.stopNext();
				const g = this.groups[ctx.sourceKey];
				const pack = buildPack([plainTag(g)], this.things.map(plainThing), this.now);
				const file = `thing-tracker-pack-${g.bundleId || slugify(g.title)}-${dayKey(this.now, this.tz)}.json`;
				ctx.ask("saveFile", [file, JSON.stringify(pack, null, 2), "application/json", "share"]);
			},
		},
		// Manage.
		setManageTab: {
			args: [t.string()],
			run(next, [tab]) {
				if (!MANAGE_TABS.some(([id]) => id === tab)) return;
				next.manageTab = tab;
				next.manageQuery = "";
			},
		},
		setManageQuery: {
			args: [t.string()],
			run(next, [query]) {
				next.manageQuery = query;
			},
		},
		browseBundles: {
			args: [],
			run(next) {
				next.tab = "manage";
				next.manageTab = "bundles";
				next.manageQuery = "";
			},
		},
		// Backups.
		backupNow: {
			args: [],
			run(next) {
				next.tab = "manage";
				next.manageTab = "data";
			},
		},
		backupLater: {
			args: [],
			run(next) {
				next.backup.dismissedAt = this.now;
			},
		},
		setInterval: {
			args: [t.string()],
			run(next, [days]) {
				const n = Number(days);
				if (!INTERVALS.some(([d]) => d === n)) return;
				next.backup.intervalDays = n;
				next.backup.dismissedAt = 0;
			},
		},
		exportAll: {
			args: [],
			emits: { ask: ["saveFile"] },
			run(_next, _args, ctx) {
				const backup = buildBackup(this.snapshot(), this.now);
				const { from, to } = backup.range;
				const name =
					from === null
						? dayKey(this.now, this.tz)
						: `${dayKey(from, this.tz)}_to_${dayKey(to, this.tz)}`;
				ctx.ask("saveFile", [
					`thing-tracker-backup-${name}.json`,
					JSON.stringify(backup, null, 2),
					"application/json",
					"backup",
				]);
			},
		},
		saveFileReplyOk(next, [kind], ctx) {
			if (kind !== "backup") {
				toast(next, ctx, "Shared", "The pack is ready to send.");
				return;
			}
			const times = this.events.map((e) => e.actualAt);
			const range =
				times.length === 0
					? ""
					: `${formatDate(Math.min(...times), this.tz, { weekday: false, now: 0 })} – ${formatDate(Math.max(...times), this.tz, { weekday: false, now: 0 })}`;
			next.backup.lastAt = this.now;
			next.backup.dismissedAt = 0;
			next.backup.rangeText = range;
			toast(next, ctx, "Backup ready", "");
		},
		saveFileReplyError(next, [error], ctx) {
			toast(next, ctx, "Export failed", String(error?.message ?? error), { kind: "error" });
		},
		saveFileHandlerNotFound(next, _args, ctx) {
			toast(next, ctx, "Export failed", "This page can't save files.", { kind: "error" });
		},
		// Imports: a file, pasted text or a bundle, previewed before anything changes.
		setImportMode: {
			args: [t.string()],
			run(next, [mode]) {
				if (mode === "merge" || mode === "replace") next.importMode = mode;
			},
		},
		setImportText: {
			args: [t.string()],
			run(next, [text]) {
				next.importText = text;
			},
		},
		previewImport: {
			args: [],
			run(next, _args, ctx) {
				openImport(next, ctx, "", this.importText);
			},
		},
		chooseFile: {
			args: [],
			emits: { ask: ["readText"] },
			run(_next, _args, ctx) {
				const file = ctx.event?.target?.files?.[0];
				if (file !== undefined) ctx.ask("readText", [file]);
			},
		},
		readTextReplyOk(next, [text], ctx) {
			openImport(next, ctx, "", String(text));
		},
		readTextReplyError(next, [error], ctx) {
			toast(next, ctx, "Couldn't read that file", String(error?.message ?? error), {
				kind: "error",
			});
		},
		readTextHandlerNotFound() {},
		addBundle: {
			args: [t.string()],
			run(next, [id], ctx) {
				const bundle = BUNDLES.find((b) => b.id === id);
				if (bundle === undefined) return;
				next.importMode = "merge";
				openImport(next, ctx, bundle.title, JSON.stringify(bundle.pack));
			},
		},
		setOverwrite: {
			args: [t.boolean()],
			run(next, [overwrite]) {
				next.overwrite = overwrite;
			},
		},
		cancelImport: {
			args: [],
			run(next) {
				next.showPreview = false;
				next.importSource = "";
			},
		},
		confirmImport: {
			args: [],
			run(next, _args, ctx) {
				const plan = this.plan;
				next.showPreview = false;
				next.importSource = "";
				if (plan === null || plan.isNoop) return;
				const C = ctx.scope.components;
				const planned = applyPlan(plan, this.snapshot());
				const known = new Set(planned.things.map((x) => x.id));
				next.things = planned.things.map((x) => thingFrom(C, x));
				next.groups = planned.groups.map((g, i) =>
					tagFrom(C, { ...g, thingIds: g.thingIds.filter((id) => known.has(id)) }, i),
				);
				next.events = planned.events.filter((e) => known.has(e.thingId)).map(eventFrom);
				next.importText = "";
				toast(next, ctx, "Imported", importedText(plan));
				refresh(this, next);
			},
		},
	},
});
// The event editor on entry id.
const openEntry = (self, next, id) => {
	const e = self.events.find((x) => x.id === id);
	if (e === undefined) return;
	const thing = self.things.find((x) => x.id === e.thingId);
	const C = scopeOf(self).components;
	const ids = [
		...new Set([
			...(thing?.measurements.map((r) => r.measurementId) ?? []),
			...e.measurements.map((m) => m.measurementId),
		]),
	];
	const values = ids.flatMap((mid) => {
		const m = findMeasurement(MEASUREMENTS, mid);
		if (m === undefined) return [];
		const base = e.measurements.find((x) => x.measurementId === mid)?.value ?? 0;
		const unit = thing?.measurements.find((r) => r.measurementId === mid)?.unit;
		return [makePrompt(C, m, unit, base, measurementHistory(self.events, e.thingId, mid), true)];
	});
	next.listContext = null;
	next.panel = C.EventEditor({
		mode: "edit",
		eventId: e.id,
		thingId: e.thingId,
		heading: thing === undefined ? "Entry" : `${thing.emoji} ${thing.title}`,
		subtitle: `Recorded ${formatRelative(e.recordedAt, self.now, self.tz)}`,
		recordedAt: e.recordedAt,
		when: toDatetimeLocal(e.actualAt, self.tz),
		tz: self.tz,
		notes: e.notes,
		values,
	});
};
const openTagEditor = (self, next, tag) => {
	const C = scopeOf(self).components;
	const members = [...self.things]
		.sort((a, b) => a.title.localeCompare(b.title))
		.map((thing) => ({
			id: thing.id,
			emoji: thing.emoji,
			title: thing.title,
			checked: tag?.thingIds.includes(thing.id) ?? false,
		}));
	next.panel = C.TagEditor({
		mode: tag === null ? "create" : "edit",
		tagId: tag?.id ?? "",
		emoji: tag?.emoji ?? "",
		title: tag?.title ?? "",
		members,
	});
};
const logEvent = (self, next, ctx, thing, measurements) => {
	const id = newId(ctx, "event");
	next.events.push({
		id,
		thingId: thing.id,
		recordedAt: self.now,
		actualAt: self.now,
		measurements,
		notes: "",
	});
	const text =
		measurements.length === 0
			? `Logged at ${formatTime(self.now, self.tz)}`
			: `${measurements
					.map((v) => formatMeasurement(findMeasurement(MEASUREMENTS, v.measurementId), v.value))
					.join(" · ")} at ${formatTime(self.now, self.tz)}`;
	toast(next, ctx, `${thing.emoji} ${thing.title}`, text, { eventId: id, kind: "logged" });
	refresh(self, next);
};

// An app with the things and tags of bundles (slugs) and events, each { thing (id), ago
// (ms before now), measurements, notes }, with what it derives already worked out.
export const trackerApp = (C, { now, tz = 0, bundles = [], events = [], ...rest }) => {
	const things = new Map();
	const groups = new Map();
	for (const slug of bundles) {
		const { pack } = BUNDLES.find((b) => b.id === slug);
		for (const t of pack.things) things.set(t.id, thingFrom(C, t));
		for (const g of pack.groups) groups.set(g.id, tagFrom(C, g, groups.size));
	}
	const made = events.map((e, i) => ({
		id: `event-${i + 1}`,
		thingId: e.thing,
		recordedAt: now - (e.recordedAgo ?? e.ago),
		actualAt: now - e.ago,
		measurements: e.measurements ?? [],
		notes: e.notes ?? "",
	}));
	const visible = [...things.values()].filter((t) => !t.archived);
	const app = C.TrackerApp({
		now,
		tz,
		things: [...things.values()],
		groups: [...groups.values()],
		events: made,
		order: rankThings(visible, usageOf(made)),
		...rest,
	});
	refresh(app, app); // Not frozen yet: made by make, not by a task.
	return app;
};

export const trackerComponents = {
	TrackerApp,
	Thing,
	Tag,
	Section,
	Bucket,
	Prompt,
	EmojiPicker,
	MeasurementWizard,
	EventEditor,
	ThingEditor,
	TagEditor,
	EntryList,
};
export { UNGROUPED };
