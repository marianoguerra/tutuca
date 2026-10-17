import { step, stories } from "../../src/storybook/index.js";
import { readText, saveFile } from "../common/files.js";
import { drink, habit, NOW, sample, trackerAppArb } from "./fixtures.js";
import { trackerApp, trackerComponents } from "./index.js";
import { BUNDLES } from "./model.js";
import { MINUTE } from "./time.js";

// Indexes into the sample app's things, for message sources.
const SAMPLE_THINGS = BUNDLES.filter((b) => b.id === "habits" || b.id === "hydration").flatMap(
	(b) => b.pack.things.map((t) => t.id),
);
const atPanel = (b) => b.field("panel");
const lastEvent = (s) => s.events.at(-1);

const appMessages = [
	"TrackerApp.setTab",
	"TrackerApp.setQuery",
	"TrackerApp.toggleCompact",
	"TrackerApp.toggleSection",
	"TrackerApp.toggleAllSections",
	"TrackerApp.reorder",
	"TrackerApp.setNow",
	"TrackerApp.setGranularity",
	"TrackerApp.setGroupFilter",
	"TrackerApp.clearGroupFilter",
	"TrackerApp.setManageTab",
	"TrackerApp.setManageQuery",
	"TrackerApp.undoToast",
	"TrackerApp.dismissToast",
	"TrackerApp.backupLater",
	"TrackerApp.setInterval",
	"TrackerApp.deleteThing",
	"TrackerApp.deleteTag",
	"Thing.tap",
	"Thing.hold",
	"Section.toggle",
	"Bucket.open",
	"Prompt.setText",
	"Prompt.adjust",
	"MeasurementWizard.next",
	"MeasurementWizard.back",
	"EventEditor.save",
	"EventEditor.setWhen",
	"EntryList.remove",
];

export default stories({
	title: "Thing tracker",
	components: trackerComponents,
	askHandlers: {
		now: () => NOW + 90 * MINUTE,
		wait: ([ms, id]) => new Promise((resolve) => setTimeout(() => resolve(id), ms)),
		saveFile,
		readText,
	},
	overrides: { TrackerApp: trackerAppArb },
	stories: {
		// Pieces.
		"Thing/Never logged": {
			make: (C) => sample(C).things.find((t) => t.id === habit("breakfast")),
		},
		"Thing/Logged often": { make: (C) => sample(C).things.find((t) => t.id === drink("coffee")) },
		"Thing/With measurements": { make: (C) => sample(C).things.find((t) => t.id === habit("run")) },
		"Section/Header": {
			make: (C) => sample(C).sections[0],
			sequences: {
				"toggle notifies the app": [
					step.send("toggle"),
					step.check("still open: the app decides", (s) => s.isOpen),
				],
			},
		},
		"Bucket/Today": { make: (C) => sample(C).buckets[0] },
		"Bucket/Quiet days": { make: (C) => sample(C).buckets.find((b) => b.gap > 0) },
		"Prompt/Duration": {
			make: (C) =>
				C.Prompt({
					measurementId: "duration",
					unitId: "min",
					base: 30 * MINUTE,
					text: "30",
					history: [30 * MINUTE, 45 * MINUTE, 30 * MINUTE],
				}),
			sequences: {
				"type, adjust and change unit": [
					step.event("input", "input", { value: "20" }),
					step.check("20 minutes", (s) => s.base === 20 * MINUTE && s.formatted === "20m"),
					step.event("click", '[aria-label="Add 10 minutes"]'),
					step.check("30 minutes", (s) => s.formatted === "30m"),
					step.send("setUnit", ["h"]),
					step.check("in hours", (s) => s.text === "0.5"),
					step.event("click", 'button[value="2700000"]'),
					step.check("a usual value", (s) => s.base === 45 * MINUTE),
					step.send("adjust", ["-60"]),
					step.check("never below zero", (s) => s.base === 0),
				],
			},
			pbt: { events: true, maxCommands: 12 },
		},
		"Prompt/Temperature (field view)": {
			make: (C) =>
				C.Prompt({ measurementId: "temperature", unitId: "c", base: 37.2, text: "37.2" }),
			sequences: {
				"to Fahrenheit": [
					step.send("setUnit", ["f"]),
					step.check("98.96°F", (s) => s.text === "99" && s.formatted === "99°F"),
				],
			},
		},
		"Emoji picker": {
			make: (C) => C.EmojiPicker({ value: "☕" }),
			sequences: {
				"browse, search and pick": [
					step.event("click", '[title="Mood"]'),
					step.check("mood emoji", (s) => s.matches.every((e) => e.category === "Mood")),
					step.event("input", '[aria-label="Search emoji"]', { value: "coff" }),
					step.check("coffee first", (s) => s.results[0].char === "☕"),
					step.event("click", 'button[value="☕"]'),
					step.check("in recents", (s) => s.recent[0] === "☕"),
					step.event("input", '[aria-label="Search emoji"]', { value: "zzzqqq" }),
					step.check("nothing matches", (s) => s.isEmpty),
					step.event("input", '[aria-label="Paste an emoji"]', { value: "🦆" }),
					step.check("pasted", (s) => s.value === "🦆"),
				],
			},
			pbt: { events: true, maxCommands: 10 },
		},
		// Panels alone; what they'd tell the app goes nowhere at the root.
		"Panel/Measurement wizard": {
			make: (C) =>
				C.MeasurementWizard({
					thingId: habit("run"),
					emoji: "🏃",
					title: "Run",
					prompts: [
						C.Prompt({
							measurementId: "distance",
							unitId: "km",
							base: 5000,
							text: "5",
							history: [5000, 8000, 5000],
						}),
						C.Prompt({ measurementId: "duration", unitId: "min", base: 0, text: "" }),
					],
				}),
			sequences: {
				"step through and ask before discarding": [
					step.check("1 of 2", (s) => s.stepText === "1 of 2" && s.primaryLabel === "Next"),
					step.send("next"),
					step.check("can't log nothing", (s) => s.cannotGo),
					step.send("setText", ["28"], { at: (b) => b.item("prompts", 1) }),
					step.check("logs 28m", (s) => s.primaryLabel === "Log 28m"),
					step.send("back"),
					step.check("back to distance", (s) => s.step === 0),
					step.send("requestClose"),
					step.check("asks first", (s) => s.confirming),
					step.send("keepEditing"),
					step.check("kept", (s) => !s.confirming),
				],
			},
			pbt: { events: true, maxCommands: 12 },
		},
		"Panel/Event editor": {
			make: (C) =>
				C.EventEditor({
					mode: "edit",
					eventId: "event-5",
					heading: "🏃 Run",
					subtitle: "Recorded yesterday",
					when: "2026-10-15T08:30",
					notes: "Felt great",
					values: [C.Prompt({ measurementId: "distance", unitId: "km", base: 5000, text: "5" })],
				}),
			sequences: {
				"an invalid time can't be saved": [
					step.event("input", '[aria-label="When did it happen?"]', { value: "" }),
					step.check("invalid", (s) => s.isInvalid),
					step.event("input", '[aria-label="When did it happen?"]', { value: "2026-10-15T07:00" }),
					step.check("valid again", (s) => s.actualAt === Date.UTC(2026, 9, 15, 7)),
				],
			},
		},
		"Panel/Thing editor": {
			make: (C) => C.ThingEditor({ mode: "create", pickerOpen: true }),
			sequences: {
				"create a thing in three steps": [
					step.check("needs a name", (s) => s.cannotGo),
					step.event("input", '[aria-label="Name"]', { value: "Swim" }),
					step.send("pick", ["🏊"], { at: (b) => b.field("picker") }),
					step.check("picked, picker closed", (s) => s.emoji === "🏊" && !s.pickerOpen),
					step.send("next"),
					step.send("toggleMeasurement", ["distance"]),
					step.send("setUnit", ["distance|m"]),
					step.check("distance in metres", (s) => s.measurements[0].unit === "m"),
					step.send("next"),
					step.send("setDescription", ["Lengths count"]),
					step.check("ready to create", (s) => s.primaryLabel === "Create"),
				],
			},
			pbt: { events: true, maxCommands: 12 },
		},
		"Panel/Tag editor": {
			make: (C) => {
				const app = sample(C);
				const tag = app.groups[0];
				const members = app.things.map((t) => ({
					id: t.id,
					emoji: t.emoji,
					title: t.title,
					checked: tag.thingIds.includes(t.id),
				}));
				return C.TagEditor({
					mode: "edit",
					tagId: tag.id,
					title: tag.title,
					emoji: tag.emoji,
					members,
				});
			},
			sequences: {
				"search and tick": [
					step.event("input", '[aria-label="Search things"]', { value: "cof" }),
					step.send("toggleMember", [SAMPLE_THINGS.indexOf(drink("coffee"))]),
					step.check("7 selected", (s) => s.selectedText === "7 selected"),
				],
			},
		},
		"Panel/Entry list": {
			make: (C) =>
				C.EntryList({
					heading: "All entries",
					subtitle: "2 of 9, newest first",
					remaining: 7,
					rows: [
						{
							id: "event-1",
							head: "☕ Coffee",
							line: "Fri 16 Oct · 08:30",
							notes: "",
							recorded: "",
						},
						{
							id: "event-8",
							head: "📖 Read",
							line: "Sat 10 Oct · 10:30",
							notes: "Finished it",
							recorded: "recorded 10:30",
						},
					],
				}),
			sequences: {
				"close without asking": [
					step.send("requestClose"),
					step.check("nothing to confirm", (s) => !s.confirming),
				],
			},
		},
		// The app.
		"App/Empty": {
			make: (C) => trackerApp(C, { now: NOW }),
			sequences: {
				"load a bundle": [
					step.event("click", "button.btn-primary"),
					step.check("on bundles", (s) => s.manageTab === "bundles"),
					step.event("click", 'button[value="mood"]'),
					step.check(
						"previewed",
						(s) => s.showPreview && s.previewLines.join() === "10 new things,1 new tag",
					),
					step.send("confirmImport"),
					step.check("ten moods", (s) => s.things.length === 10 && s.toast.title === "Imported"),
					step.send("setTab", ["track"]),
					step.check(
						"one section",
						(s) => s.sections.length === 1 && s.sections[0].title === "Mood",
					),
				],
			},
		},
		"App/Track": {
			make: (C) => sample(C),
			sequences: {
				"log, undo and log with measurements": [
					step.send("logThing", [habit("breakfast")]),
					step.check(
						"logged with a toast",
						(s) => s.toast.kind === "logged" && s.events.length === 10,
					),
					step.send("undoToast"),
					step.check("undone", (s) => s.events.length === 9 && s.toast === null),
					step.event("click", '[aria-label^="Log Run,"]'),
					step.check("asks for distance, last time's", (s) => s.panel.prompts[0].base === 5000),
					step.send("next", [], { at: atPanel }),
					step.send("next", [], { at: atPanel }),
					step.check(
						"logged 5km and 28m",
						(s) => lastEvent(s).measurements.length === 2 && s.panel === null,
					),
					step.check("toast says so", (s) => s.toast.text === "5km · 28m at 10:30"),
				],
				"search, collapse and compact": [
					step.event("input", '[aria-label="Search things"]', { value: "coffee" }),
					step.check(
						"one thing found",
						(s) => s.sections.length === 1 && s.sections[0].memberIds.length === 1,
					),
					step.send("setQuery", ["unicorn"]),
					step.check("nothing matches", (s) => s.noMatches),
					step.event("click", "main .btn-primary"),
					step.check("create it", (s) => s.panel.title === "unicorn"),
					step.send("closePanel"),
					step.send("setQuery", [""]),
					step.send("toggleAllSections"),
					step.check("all collapsed", (s) => !s.anyOpen),
					step.event("click", '[aria-label="Expand all sections"]'),
					step.check("all open", (s) => s.sections.every((x) => x.isOpen)),
					step.send("toggleCompact"),
					step.check("compact", (s) => s.gridView === "compact"),
				],
				"backdate with a long press": [
					step.event("contextmenu", '[aria-label^="Log Run,"]'),
					step.check("an unsaved entry", (s) => s.panel.mode === "create" && s.events.length === 9),
					step.send("setWhen", ["2026-10-16T07:00"], { at: atPanel }),
					step.send("save", [], { at: atPanel }),
					step.check("logged at 7", (s) => lastEvent(s).actualAt === Date.UTC(2026, 9, 16, 7)),
				],
			},
			pbt: { include: appMessages, maxCommands: 15 },
		},
		"App/Insights by day": {
			make: (C) => sample(C, { tab: "insights" }),
			sequences: {
				"drill into a chip, edit and delete an entry": [
					step.check(
						"today, yesterday and a gap",
						(s) => s.buckets[0].label === "Today" && s.buckets.some((b) => b.gap > 0),
					),
					step.event("click", '[aria-label^="Water,"]'),
					step.check(
						"water today",
						(s) => s.panel.heading === "💧 Water" && s.panel.rows.length === 1,
					),
					step.send("open", [0], { at: atPanel }),
					step.check("editing it", (s) => s.panel.mode === "edit"),
					step.send("setNotes", ["Big glass"], { at: atPanel }),
					step.send("save", [], { at: atPanel }),
					step.check(
						"saved",
						(s) => s.events.find((e) => e.id === "event-3").notes === "Big glass",
					),
					step.send("openAllEntries"),
					step.check(
						"all, newest first",
						(s) => s.panel.rows.length === 9 && s.panel.subtitle === "9 of 9, newest first",
					),
					step.send("remove", [0], { at: atPanel }),
					step.check("one less", (s) => s.events.length === 8 && s.panel.rows.length === 8),
				],
			},
		},
		"App/Insights by week": { make: (C) => sample(C, { tab: "insights", granularity: "week" }) },
		"App/Insights by month, filtered": {
			make: (C) =>
				sample(C, { tab: "insights", granularity: "month", groupFilter: "group:habits/exercise" }),
			sequences: {
				"clear the filter": [
					step.check("only runs", (s) =>
						s.buckets.every((b) =>
							b.chips.every((c) => c.thingId === habit("run") || c.thingId === habit("nap")),
						),
					),
					step.send("clearGroupFilter"),
					step.check("everything", (s) => s.buckets[0].total === 8),
				],
			},
		},
		"App/Manage things": {
			make: (C) => sample(C, { tab: "manage" }),
			sequences: {
				"edit a thing": [
					step.event("input", '[aria-label="Search things…"]', { value: "run" }),
					step.event("click", "li button"),
					step.check("editing Run", (s) => s.panel.title === "Run" && s.panel.mode === "edit"),
					step.send("setTitle", ["Jog"], { at: atPanel }),
					step.send("next", [], { at: atPanel }),
					step.send("next", [], { at: atPanel }),
					step.send("next", [], { at: atPanel }),
					step.check("renamed", (s) => s.things.some((t) => t.title === "Jog")),
				],
				"delete a thing and its entries": [
					step.send("editThing", [habit("run")]),
					step.send("remove", [], { at: atPanel }),
					step.check(
						"gone with its entries",
						(s) => !s.events.some((e) => e.thingId === habit("run")),
					),
					step.check(
						"and from its tag",
						(s) => !s.groups.some((g) => g.thingIds.includes(habit("run"))),
					),
				],
			},
		},
		"App/Manage tags": {
			make: (C) => sample(C, { tab: "manage", manageTab: "groups" }),
			sequences: {
				"make a tag": [
					step.send("newTag"),
					step.send("setTitle", ["Morning"], { at: atPanel }),
					step.send("toggleMember", [0], { at: atPanel }),
					step.send("save", [], { at: atPanel }),
					step.check(
						"last tag",
						(s) => s.groups.at(-1).title === "Morning" && s.groups.at(-1).thingIds.length === 1,
					),
				],
				"share a tag": [
					step.send("shareTag", [], { from: (b) => b.item("groups", 0) }),
					step.check("shared", (s) => s.toast.title === "Shared"),
				],
			},
		},
		"App/Manage units": { make: (C) => sample(C, { tab: "manage", manageTab: "units" }) },
		"App/Manage bundles": { make: (C) => sample(C, { tab: "manage", manageTab: "bundles" }) },
		"App/Manage data": {
			make: (C) => sample(C, { tab: "manage", manageTab: "data" }),
			sequences: {
				"export, then import into a new app": [
					step.send("exportAll"),
					step.check(
						"backed up",
						(s) => s.backup.lastAt === NOW && s.toast.title === "Backup ready",
					),
					step.check("no reminder", (s) => !s.backupDue),
					step.send("setImportText", ["{"]),
					step.send("previewImport"),
					step.check("not JSON", (s) => s.toast.text === "That file isn't JSON."),
					step.send("setImportText", [
						JSON.stringify({
							format: "thing-tracker/backup",
							version: 1,
							things: [],
							groups: [],
							events: [],
						}),
					]),
					step.send("setImportMode", ["replace"]),
					step.send("previewImport"),
					step.check("warns", (s) =>
						s.previewWarnings[0].startsWith("Replaces everything on this device: 29 things"),
					),
					step.send("confirmImport"),
					step.check("empty", (s) => s.things.length === 0 && s.events.length === 0),
				],
				"remind me": [
					step.send("setInterval", ["0"]),
					step.check("never due", (s) => !s.backupDue),
				],
			},
		},
		"App/Sync time": {
			make: (C) => sample(C),
			sequences: {
				"an hour and a half later": [
					step.send("syncNow"),
					step.check(
						"coffee 4h ago",
						(s) => s.things.find((t) => t.id === drink("coffee")).lastText === "4h ago",
					),
				],
			},
		},
		"App/Generated": {
			arbitrary: (A) => A.instance("TrackerApp"),
			pbt: { include: appMessages, maxCommands: 15 },
		},
		"App/DOM events": { make: (C) => sample(C), pbt: { events: true, maxCommands: 15 } },
	},
});
