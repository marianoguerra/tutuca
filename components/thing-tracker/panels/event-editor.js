// Edits a logged event: when it happened, its measurements and notes.

import {
	$if,
	button,
	component,
	field,
	renderEach,
	send,
	t,
	tag,
	targetValue,
} from "../../../src/tutuca.js";
import { always, closing, panel } from "../panel.js";
import { fromDatetimeLocal } from "../time.js";

const { div, input, label, p, textarea } = tag;

export const EventEditor = component({
	name: "EventEditor",
	fields: {
		mode: t.enum("create", "edit"),
		eventId: t.string(),
		thingId: t.string(),
		heading: t.string("Entry"),
		subtitle: t.string(),
		recordedAt: t.number().int(),
		when: t.string(),
		tz: t.number().int().min(-840).max(840),
		notes: t.string(),
		values: t.array(t.component("Prompt")),
		confirming: t.boolean(),
	},
	methods: {
		get actualAt() {
			return fromDatetimeLocal(this.when, this.tz);
		},
		get isInvalid() {
			return this.actualAt === null;
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get primaryLabel() {
			return this.isEdit ? "Save" : "Log entry";
		},
		get confirmTitle() {
			return this.isEdit ? "Discard changes?" : "Discard this entry?";
		},
		get confirmText() {
			return this.isEdit ? "Your edits won't be saved." : "Nothing has been logged yet.";
		},
		keepLabel: "Keep editing",
	},
	loops: { fields: { view: "field" } },
	view: panel({
		title: field("heading"),
		description: field("subtitle"),
		body: div(
			{ class: "space-y-4" },
			div(
				{ class: "flex flex-col gap-1.5" },
				label({ class: "text-sm font-medium" }, "When did it happen?"),
				input({
					type: "datetime-local",
					class: "input input-sm w-full",
					"aria-label": "When did it happen?",
					"aria-invalid": $if(field("isInvalid"), "true", "false"),
					value: field("when"),
					"on:input": send("setWhen", targetValue()),
				}),
				$if(field("isInvalid"), p({ class: "text-xs text-error" }, "That isn't a valid time."), ""),
			),
			renderEach(field("values"), "fields"),
			div(
				{ class: "flex flex-col gap-1.5" },
				label({ class: "text-sm font-medium" }, "Notes (optional)"),
				textarea({
					class: "textarea w-full",
					rows: "3",
					"aria-label": "Notes",
					placeholder: "Anything worth remembering about this one?",
					value: field("notes"),
					"on:input": send("setNotes", targetValue()),
				}),
			),
		),
		foot: [
			$if(
				field("isEdit"),
				button(
					{ class: "btn btn-outline h-12 shrink-0 text-error", "on:click": send("remove") },
					"Delete",
				),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1 text-base",
					disabled: field("isInvalid"),
					"on:click": send("save"),
				},
				field("primaryLabel"),
			),
		],
	}),
	on: {
		...closing(always),
		setWhen: {
			args: [t.string()],
			run(draft, [when]) {
				draft.when = when;
			},
		},
		setNotes: {
			args: [t.string()],
			run(draft, [notes]) {
				draft.notes = notes;
			},
		},
		save: {
			args: [],
			emits: { notify: ["saveEntry"] },
			run(_draft, _args, ctx) {
				const { actualAt } = this;
				if (actualAt === null) return;
				const measurements = this.values
					.filter((v) => v.base > 0)
					.map((v) => ({ measurementId: v.measurementId, value: v.base }));
				const { mode, eventId: id, thingId, recordedAt, notes } = this;
				ctx.notify("saveEntry", [{ mode, id, thingId, recordedAt, actualAt, notes, measurements }]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["deleteEntry"] },
			run(_draft, _args, ctx) {
				ctx.notify("deleteEntry", [this.eventId]);
			},
		},
	},
});
