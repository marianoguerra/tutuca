// Asks a thing's measurements one at a time when logging it.

import {
	$if,
	button,
	component,
	field,
	render,
	send,
	seqItem,
	t,
	tag,
} from "../../../src/tutuca.js";
import { MUTED } from "../common.js";
import { always, closing, panel } from "../panel.js";

const { span } = tag;

export const MeasurementWizard = component({
	name: "MeasurementWizard",
	fields: {
		thingId: t.string(),
		emoji: t.string(),
		title: t.string(),
		prompts: t.array(t.component("Prompt")).len(1),
		step: t.index("prompts"),
		confirming: t.boolean(),
	},
	methods: {
		get current() {
			return this.prompts[this.step];
		},
		get heading() {
			return `${this.emoji} ${this.title}`;
		},
		get isMulti() {
			return this.prompts.length > 1;
		},
		get stepText() {
			return `${this.step + 1} of ${this.prompts.length}`;
		},
		get progressStyle() {
			return `width: ${Math.round(((this.step + 1) / this.prompts.length) * 100)}%`;
		},
		get hasBack() {
			return this.step > 0;
		},
		get isLast() {
			return this.step === this.prompts.length - 1;
		},
		get cannotGo() {
			return !(this.current.base > 0);
		},
		get primaryLabel() {
			return this.isLast ? `Log ${this.current.formatted}` : "Next";
		},
		confirmTitle: "Discard this entry?",
		confirmText: "Nothing has been logged yet.",
		keepLabel: "Keep going",
	},
	view: panel({
		title: field("heading"),
		description: "",
		extra: $if(
			field("isMulti"),
			span({ class: `text-xs tabular-nums ${MUTED}` }, field("stepText")),
			"",
		),
		progress: field("progressStyle"),
		body: render(seqItem("prompts", "step")),
		foot: [
			$if(
				field("hasBack"),
				button({ class: "btn btn-outline h-12 shrink-0", "on:click": send("back") }, "← Back"),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1 text-base",
					disabled: field("cannotGo"),
					"on:click": send("next"),
				},
				field("primaryLabel"),
			),
		],
	}),
	on: {
		...closing(always),
		back: {
			args: [],
			run(next) {
				if (this.step > 0) next.step = this.step - 1;
			},
		},
		next: {
			args: [],
			emits: { notify: ["commitLog"] },
			run(next, _args, ctx) {
				if (!(this.current.base > 0)) return;
				if (!this.isLast) {
					next.step = this.step + 1;
					return;
				}
				const values = this.prompts.map((pr) => ({
					measurementId: pr.measurementId,
					value: pr.base,
				}));
				ctx.notify("commitLog", [this.thingId, values]);
			},
		},
	},
});
