// A workbench over the math components: they sit under tabs, and the problems solved along the
// way are kept in a history to go back to.
import { $if, component, each, field, render, send, sourceKey, t, tag } from "../../src/tutuca.js";
import { fmt, mathComponents } from "./index.js";

const { aside, button, div, h2, li, p, span, ul } = tag;

const TABS = [
	["quadratic", "Quadratic"],
	["matrix", "Matrix"],
	["formulas", "Formulas"],
];

// "x² − 3x + 2 = 0" for a, b, c.
const term = (n, x, first) => {
	if (n === 0) return "";
	const sign = n < 0 ? "−" : first ? "" : "+";
	const abs = Math.abs(n);
	const k = abs === 1 && x !== "" ? "" : fmt(abs);
	return `${first ? sign : ` ${sign} `}${k}${x}`;
};
export const quadraticLabel = (a, b, c) =>
	`${term(a, "x²", true)}${term(b, "x", false)}${term(c, "", false)} = 0`;
export const matrixLabel = (a, b, c, d) => `(${a} ${b} | ${c} ${d}), det ${fmt(a * d - b * c)}`;

const tabButton = (id, label) =>
	button(
		{
			type: "button",
			role: "tab",
			class: $if(field(`is_${id}`), "tab tab-active", "tab"),
			"@on.click": send("setTab", id),
		},
		label,
	);

// The math components under tabs, with the problems saved along the way.
export const Workbench = component({
	name: "Workbench",
	fields: (t) => ({
		tab: t.enum(...TABS.map(([id]) => id)),
		quadratic: t.component("Quadratic"),
		matrix: t.component("Matrix2"),
		gallery: t.component("FormulaGallery"),
		history: t.array(
			t.record({
				kind: t.enum("quadratic", "matrix"),
				label: t.string(),
				values: t.array(t.number()),
			}),
		),
	}),
	methods: {
		get is_quadratic() {
			return this.tab === "quadratic";
		},
		get is_matrix() {
			return this.tab === "matrix";
		},
		get is_formulas() {
			return this.tab === "formulas";
		},
		get hasHistory() {
			return this.history.length > 0;
		},
		// The problem on the current tab, as a history entry.
		get problem() {
			if (this.is_quadratic) {
				const { a, b, c } = this.quadratic;
				return { kind: "quadratic", label: quadraticLabel(a, b, c), values: [a, b, c] };
			}
			if (this.is_matrix) {
				const { a, b, c, d } = this.matrix;
				return { kind: "matrix", label: matrixLabel(a, b, c, d), values: [a, b, c, d] };
			}
			return null;
		},
		get cannotSave() {
			const { problem } = this;
			return problem === null || this.history.some((h) => h.label === problem.label);
		},
	},
	view: div(
		{ class: "flex flex-col gap-4 lg:flex-row lg:items-start" },
		div(
			{ class: "card flex-1 border border-base-300 bg-base-100 p-4 shadow-sm" },
			div(
				{ class: "mb-4 flex flex-wrap items-center justify-between gap-2" },
				div(
					{ class: "tabs tabs-box", role: "tablist" },
					...TABS.map(([id, l]) => tabButton(id, l)),
				),
				button(
					{
						type: "button",
						class: "btn btn-sm btn-primary",
						disabled: field("cannotSave"),
						"@on.click": send("saveProblem"),
					},
					"Save problem",
				),
			),
			$if(field("is_quadratic"), render(field("quadratic")), ""),
			$if(field("is_matrix"), render(field("matrix")), ""),
			$if(field("is_formulas"), render(field("gallery")), ""),
		),
		aside(
			{ class: "card w-full border border-base-300 bg-base-100 p-4 shadow-sm lg:w-80" },
			h2(
				{ class: "mb-2 text-sm font-semibold uppercase tracking-wider opacity-60" },
				"Saved problems",
			),
			$if(
				field("hasHistory"),
				ul(
					{ class: "flex flex-col gap-1" },
					each(
						field("history"),
						li(
							{ class: "flex items-center gap-1" },
							button(
								{
									type: "button",
									class: "btn btn-ghost btn-sm flex-1 justify-start font-mono",
									title: "Open",
									"@on.click": send("openProblem", sourceKey()),
								},
								span({ class: "badge badge-soft badge-sm" }, field("kind")),
								field("label"),
							),
							button(
								{
									type: "button",
									class: "btn btn-ghost btn-sm btn-circle text-error",
									title: "Remove",
									"aria-label": "Remove problem",
									"@on.click": send("removeProblem", sourceKey()),
								},
								"×",
							),
						),
					),
				),
				p({ class: "text-sm opacity-60" }, "Save a quadratic or a matrix to come back to it."),
			),
		),
	),
	on: {
		setTab: {
			args: [t.enum(...TABS.map(([id]) => id))],
			run(draft, [tab]) {
				draft.tab = tab;
			},
		},
		saveProblem: {
			args: [],
			run(draft) {
				if (!this.cannotSave) draft.history.unshift(this.problem);
			},
		},
		openProblem: {
			args: [t.index("history")],
			run(draft, [i]) {
				const { kind, values } = this.history[i];
				if (kind === "quadratic") {
					const [a, b, c] = values;
					Object.assign(draft.quadratic, { a, b, c });
				} else {
					const [a, b, c, d] = values;
					Object.assign(draft.matrix, { a, b, c, d });
				}
				draft.tab = kind;
			},
		},
		removeProblem: {
			args: [t.index("history")],
			post: (prev, next) => next.history.length === prev.history.length - 1,
			run(draft, [i]) {
				draft.history.splice(i, 1);
			},
		},
	},
});

export const workbenchComponents = { ...mathComponents, Workbench };
