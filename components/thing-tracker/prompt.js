// The value of one measurement, as the measurement wizard asks it (main) or as the event
// editor shows it (field).

import {
	$if,
	button,
	component,
	each,
	field,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { MUTED } from "./common.js";
import {
	commonValues,
	findMeasurement,
	findUnit,
	formatMeasurement,
	MEASUREMENTS,
	preferredUnit,
	textIn,
	toBase,
} from "./measure.js";

const { div, h2, h3, input, label, p } = tag;

const CHIP = "rounded-full border px-3 py-1.5 text-xs font-medium";
const UNIT_BTN = "rounded px-2 py-1 text-xs font-medium";
const ADJUST =
	"flex min-h-12 items-center justify-center gap-1 rounded-xl border border-base-300 text-sm font-medium tabular-nums disabled:opacity-40";
export const Prompt = component({
	name: "Prompt",
	fields: {
		measurementId: t.enum(...MEASUREMENTS.map((m) => m.id)),
		unitId: t.string(),
		base: t.number().min(0),
		text: t.string(),
		history: t.array(t.number().min(0)),
	},
	methods: {
		get measurement() {
			return findMeasurement(MEASUREMENTS, this.measurementId);
		},
		get unit() {
			return findUnit(this.measurement.units, this.unitId) ?? this.measurement.units[0];
		},
		get heading() {
			return `${this.measurement.emoji} ${this.measurement.name}`;
		},
		get name() {
			return this.measurement.name;
		},
		get formatted() {
			return formatMeasurement(this.measurement, this.base, this.unit.id);
		},
		get hasValue() {
			return this.base > 0;
		},
		get hasUnits() {
			return this.measurement.units.length > 1;
		},
		get unitChips() {
			return this.measurement.units.map((u) => {
				const on = u.id === this.unit.id;
				return {
					value: u.id,
					label: u.label,
					symbol: u.symbol.trim() || u.label,
					pill: on
						? `${CHIP} border-transparent bg-primary text-primary-content`
						: `${CHIP} border-base-300 ${MUTED}`,
					button: on
						? `${UNIT_BTN} bg-primary text-primary-content`
						: `${UNIT_BTN} bg-base-200 ${MUTED}`,
				};
			});
		},
		get usual() {
			return commonValues(this.history).map((v) => ({
				value: String(v),
				label: formatMeasurement(this.measurement, v, this.unit.id),
				cls:
					v === this.base
						? "min-h-11 rounded-xl border border-transparent bg-primary px-4 text-sm font-medium tabular-nums text-primary-content"
						: "min-h-11 rounded-xl border border-base-300 px-4 text-sm font-medium tabular-nums",
			}));
		},
		get hasUsual() {
			return this.history.length > 0;
		},
		get stepUnit() {
			return findUnit(this.measurement.units, this.measurement.stepUnit) ?? this.unit;
		},
		get adjustTitle() {
			return `Adjust (${this.stepUnit.symbol.trim() || this.stepUnit.label})`;
		},
		get adjusts() {
			const { steps } = this.measurement;
			const name = this.stepUnit.label;
			return [
				...steps.map((v) => ({
					value: String(v),
					label: `+${v}`,
					aria: `Add ${v} ${name}`,
					disabled: false,
				})),
				...steps.map((v) => ({
					value: String(-v),
					label: `−${v}`,
					aria: `Subtract ${v} ${name}`,
					disabled: this.base <= 0,
				})),
			];
		},
	},
	views: {
		main: div(
			{ class: "flex flex-col" },
			h2(
				{
					class:
						"mb-4 flex items-center justify-center gap-1.5 text-center text-base font-semibold",
				},
				field("heading"),
			),
			input({
				type: "number",
				inputmode: "decimal",
				min: "0",
				step: "any",
				class: "input mx-auto block h-16 w-44 text-center text-3xl font-semibold tabular-nums",
				"aria-label": field("name"),
				value: field("text"),
				"on:input": send("setText", targetValue()),
			}),
			p({ class: `mt-2 text-center text-sm ${MUTED}`, "aria-live": "polite" }, field("formatted")),
			$if(
				field("hasUnits"),
				div(
					{ class: "mt-4 flex flex-wrap justify-center gap-1.5" },
					each(
						field("unitChips"),
						button(
							{
								class: field("pill"),
								value: field("value"),
								"on:click": send("setUnit", targetValue()),
							},
							field("label"),
						),
					),
				),
				"",
			),
			$if(
				field("hasUsual"),
				div(
					{ class: "mt-6" },
					h3({ class: `mb-2 text-xs font-medium ${MUTED}` }, "Usual"),
					div(
						{ class: "flex flex-wrap gap-2" },
						each(
							field("usual"),
							button(
								{
									class: field("cls"),
									value: field("value"),
									"on:click": send("setBase", targetValue()),
								},
								field("label"),
							),
						),
					),
				),
				"",
			),
			div(
				{ class: "mt-6" },
				h3({ class: `mb-2 text-xs font-medium ${MUTED}` }, field("adjustTitle")),
				div(
					{ class: "grid grid-cols-3 gap-2" },
					each(
						field("adjusts"),
						button(
							{
								class: ADJUST,
								value: field("value"),
								disabled: field("disabled"),
								"aria-label": field("aria"),
								"on:click": send("adjust", targetValue()),
							},
							field("label"),
						),
					),
				),
			),
		),
		field: div(
			{ class: "flex flex-col gap-1.5" },
			label({ class: "text-sm font-medium" }, field("name")),
			div(
				{ class: "flex items-start gap-2" },
				input({
					type: "number",
					inputmode: "decimal",
					min: "0",
					step: "any",
					placeholder: "0",
					class: "input input-sm w-24 tabular-nums",
					"aria-label": field("name"),
					value: field("text"),
					"on:input": send("setText", targetValue()),
				}),
				div(
					{ class: "flex max-h-20 flex-wrap gap-1 overflow-y-auto" },
					each(
						field("unitChips"),
						button(
							{
								class: field("button"),
								value: field("value"),
								"on:click": send("setUnit", targetValue()),
							},
							field("symbol"),
						),
					),
				),
			),
			$if(field("hasValue"), p({ class: `text-xs tabular-nums ${MUTED}` }, field("formatted")), ""),
		),
	},
	on: {
		setText: {
			args: [t.string()],
			run(next, [text]) {
				next.text = text;
				const n = Number.parseFloat(text);
				next.base = text.trim() === "" || Number.isNaN(n) ? 0 : Math.max(0, toBase(n, this.unit));
			},
		},
		// Shows the same value in another unit.
		setUnit: {
			args: [t.string()],
			run(next, [unitId]) {
				const u = findUnit(this.measurement.units, unitId);
				if (u === undefined) return;
				next.unitId = u.id;
				next.text = this.base > 0 || this.text !== "" ? textIn(this.base, u) : "";
			},
		},
		setBase: {
			args: [t.string()],
			run(next, [value]) {
				const base = Number(value);
				if (!Number.isFinite(base) || base < 0) return;
				next.base = base;
				next.text = textIn(base, this.unit);
			},
		},
		adjust: {
			args: [t.string()],
			run(next, [value]) {
				const steps = Number(value);
				if (!Number.isFinite(steps)) return;
				const base = Math.max(0, this.base + steps * this.stepUnit.factor);
				next.base = base;
				next.text = textIn(base, this.unit);
			},
		},
	},
});
// A prompt for measurement in a thing's unit, from its history; blank in the editor.
export const makePrompt = (C, m, thingUnit, base, history, blank = false) => {
	const u = preferredUnit(m, thingUnit, base);
	return C.Prompt({
		measurementId: m.id,
		unitId: u.id,
		base,
		text: blank && base === 0 ? "" : textIn(base, u),
		history,
	});
};
