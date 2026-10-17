// Creates or edits a thing in steps: name and emoji, what to record, notes.

import {
	$if,
	button,
	component,
	each,
	field,
	render,
	send,
	t,
	tag,
	targetValue,
} from "../../../src/tutuca.js";
import { MUTED, measureRef } from "../common.js";
import { findMeasurement, findUnit, MEASUREMENTS } from "../measure.js";
import { always, closing, panel } from "../panel.js";

const { div, input, label, li, p, span, textarea, ul } = tag;

const STEPS = ["Name & emoji", "What to record", "Notes"];
export const ThingEditor = component({
	name: "ThingEditor",
	fields: (t) => ({
		mode: t.enum("create", "edit"),
		thingId: t.string(),
		step: t.number().int().min(0).max(2),
		emoji: t.string("⭐"),
		title: t.string(),
		description: t.string(),
		measurements: t.array(measureRef(t)),
		pickerOpen: t.boolean(),
		picker: t.component("EmojiPicker"),
		clash: t.string(),
		confirming: t.boolean(),
	}),
	methods: {
		get heading() {
			return this.mode === "edit" ? "Edit thing" : "New thing";
		},
		get stepName() {
			return STEPS[this.step];
		},
		get stepText() {
			return `${this.step + 1} of 3`;
		},
		get progressStyle() {
			return `width: ${Math.round(((this.step + 1) / 3) * 100)}%`;
		},
		get isStep0() {
			return this.step === 0;
		},
		get isStep1() {
			return this.step === 1;
		},
		get isStep2() {
			return this.step === 2;
		},
		get hasBack() {
			return this.step > 0;
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get cannotGo() {
			return this.step === 0 && (this.title.trim() === "" || this.emoji === "");
		},
		get primaryLabel() {
			return this.step < 2 ? "Next" : this.isEdit ? "Save" : "Create";
		},
		get deleteLabel() {
			return `Delete ${this.title}`;
		},
		get hasClash() {
			return this.clash !== "";
		},
		get choices() {
			return [...MEASUREMENTS]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((m) => {
					const ref = this.measurements.find((r) => r.measurementId === m.id);
					return {
						id: m.id,
						label: `${m.emoji} ${m.name}`,
						checked: ref !== undefined,
						showUnits: ref !== undefined && m.units.length > 1,
						units: m.units.map((u) => ({
							value: `${m.id}|${u.id}`,
							label: u.label,
							cls:
								u.id === ref?.unit
									? "rounded-full border border-transparent bg-primary px-2 py-0.5 text-[0.6875rem] font-medium text-primary-content"
									: `rounded-full border border-base-300 px-2 py-0.5 text-[0.6875rem] font-medium ${MUTED}`,
						})),
					};
				});
		},
		get confirmTitle() {
			return this.isEdit ? "Discard changes?" : "Discard this thing?";
		},
		confirmText: "Nothing has been saved yet.",
		keepLabel: "Keep editing",
	},
	view: panel({
		title: field("heading"),
		description: field("stepName"),
		extra: span({ class: `text-xs tabular-nums ${MUTED}` }, field("stepText")),
		progress: field("progressStyle"),
		body: div(
			{},
			$if(
				field("isStep0"),
				div(
					{ class: "flex flex-col gap-3" },
					div(
						{ class: "flex items-start gap-3" },
						div(
							{ class: "flex flex-col gap-1.5" },
							label({ class: "text-sm font-medium" }, "Emoji"),
							button(
								{
									class:
										"emoji flex size-14 items-center justify-center rounded-xl border border-base-300 text-3xl",
									"aria-label": "Choose an emoji",
									"@on.click": send("togglePicker"),
								},
								field("emoji"),
							),
						),
						div(
							{ class: "flex flex-1 flex-col gap-1.5" },
							label({ class: "text-sm font-medium" }, "Name"),
							input({
								class: "input h-14 w-full text-base",
								placeholder: "Coffee",
								enterkeyhint: "done",
								"aria-label": "Name",
								value: field("title"),
								"@on.input": send("setTitle", targetValue()),
							}),
						),
					),
					$if(field("hasClash"), p({ class: `text-xs ${MUTED}` }, field("clash")), ""),
					$if(field("pickerOpen"), render(field("picker")), ""),
				),
				"",
			),
			$if(
				field("isStep1"),
				div(
					{ class: "flex flex-col gap-2" },
					label({ class: "text-sm font-medium" }, "Record a value when logging"),
					p(
						{ class: `text-xs ${MUTED}` },
						"Leave all unticked and one tap logs it outright. Tick any and tapping asks for them first, pre-filled with last time's.",
					),
					ul(
						{ class: "flex flex-col" },
						each(
							field("choices"),
							li(
								{ class: "flex flex-col" },
								label(
									{ class: "flex items-center gap-3 py-2 text-sm" },
									input({
										type: "checkbox",
										class: "checkbox checkbox-sm",
										checked: field("checked"),
										value: field("id"),
										"@on.change": send("toggleMeasurement", targetValue()),
									}),
									field("label"),
								),
								$if(
									field("showUnits"),
									div(
										{ class: "flex flex-wrap gap-1 pb-1.5 pl-9" },
										each(
											field("units"),
											button(
												{
													class: field("cls"),
													value: field("value"),
													"@on.click": send("setUnit", targetValue()),
												},
												field("label"),
											),
										),
									),
									"",
								),
							),
						),
					),
				),
				"",
			),
			$if(
				field("isStep2"),
				div(
					{ class: "flex flex-col gap-1.5" },
					label({ class: "text-sm font-medium" }, "Notes (optional)"),
					textarea({
						class: "textarea w-full",
						rows: "3",
						"aria-label": "Notes",
						placeholder: "What counts as one of these?",
						value: field("description"),
						"@on.input": send("setDescription", targetValue()),
					}),
				),
				"",
			),
		),
		foot: [
			$if(
				field("isEdit"),
				button(
					{
						class: "btn btn-outline btn-square size-12 text-error",
						"aria-label": field("deleteLabel"),
						"@on.click": send("remove"),
					},
					"🗑",
				),
				"",
			),
			$if(
				field("hasBack"),
				button({ class: "btn btn-outline h-12", "@on.click": send("back") }, "Back"),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1",
					disabled: field("cannotGo"),
					"@on.click": send("next"),
				},
				field("primaryLabel"),
			),
		],
	}),
	on: {
		...closing(always),
		togglePicker: {
			args: [],
			run(draft) {
				draft.pickerOpen = !this.pickerOpen;
			},
		},
		emojiPicked: {
			args: [t.string()],
			run(draft, [emoji], ctx) {
				draft.emoji = emoji;
				draft.pickerOpen = false;
				ctx.stopNext();
			},
		},
		setTitle: {
			args: [t.string()],
			run(draft, [title]) {
				draft.title = title;
			},
		},
		setDescription: {
			args: [t.string()],
			run(draft, [description]) {
				draft.description = description;
			},
		},
		// The checkbox's value is the measurement's id.
		toggleMeasurement: {
			args: [t.string()],
			run(draft, [value]) {
				const m = findMeasurement(MEASUREMENTS, value);
				if (m === undefined) return;
				const i = this.measurements.findIndex((r) => r.measurementId === m.id);
				if (i >= 0) draft.measurements.splice(i, 1);
				else draft.measurements.push({ measurementId: m.id, unit: m.defaultUnit });
			},
		},
		// A chip's value is "measurementId|unitId".
		setUnit: {
			args: [t.string()],
			run(draft, [value]) {
				const [measurementId, unitId] = value.split("|");
				const ref = draft.measurements.find((r) => r.measurementId === measurementId);
				const m = findMeasurement(MEASUREMENTS, measurementId);
				if (ref !== undefined && m !== undefined && findUnit(m.units, unitId) !== undefined)
					ref.unit = unitId;
			},
		},
		back: {
			args: [],
			run(draft) {
				if (this.step > 0) draft.step = this.step - 1;
			},
		},
		next: {
			args: [],
			emits: { notify: ["saveThing"] },
			run(draft, _args, ctx) {
				if (this.cannotGo) return;
				if (this.step < 2) {
					draft.step = this.step + 1;
					draft.pickerOpen = false;
					return;
				}
				const { mode, thingId: id, emoji, measurements } = this;
				const thing = {
					id,
					emoji,
					title: this.title.trim(),
					description: this.description.trim(),
					measurements,
				};
				ctx.notify("saveThing", [mode, thing]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["deleteThing"] },
			run(_draft, _args, ctx) {
				ctx.notify("deleteThing", [this.thingId]);
			},
		},
	},
});
