// MathML for an illustrative case: a quadratic equation explorer that shows the equation,
// the quadratic formula with the coefficients put in, the discriminant and the roots, real
// or complex, next to a plot of the parabola; a 2×2 matrix with its determinant and
// inverse; and a gallery of classic formulas.

import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";

const { div, h3, input, label, p, span } = tag;
const {
	math,
	mfrac,
	mi,
	mn,
	mo,
	mrow,
	msqrt,
	msub,
	msubsup,
	msup,
	mtable,
	mtd,
	mtext,
	mtr,
	munderover,
} = tag;
const { circle, g, line, path, svg } = tag;

// Numbers as MathML shows them: up to 3 decimals, a real minus sign.
export const fmt = (n) => {
	const v = Math.round(n * 1000) / 1000;
	return (Object.is(v, -0) ? 0 : v).toString().replace("-", "−");
};
const abs = (n) => fmt(Math.abs(n));
// A coefficient in a product: (−2) in parentheses when negative.
const factor = (n) => (n < 0 ? `(${fmt(n)})` : fmt(n));
const coefficient = () =>
	t
		.number()
		.min(-20)
		.max(20)
		.arb((fc) => fc.integer({ min: -20, max: 20 }));

const PRESETS = {
	"two roots": [1, -3, 2],
	"double root": [1, -4, 4],
	"complex roots": [1, 2, 5],
	"upside down": [-0.5, 1, 4],
};

export const Quadratic = component({
	name: "Quadratic",
	fields: {
		a: coefficient()
			.default(1)
			.where((a) => a !== 0, "notZero")
			.arb((fc) => fc.integer({ min: -20, max: 20 }).filter((n) => n !== 0)),
		b: coefficient(),
		c: coefficient(),
	},
	methods: {
		get discriminant() {
			return this.b * this.b - 4 * this.a * this.c;
		},
		get kind() {
			const d = this.discriminant;
			return d > 0 ? "real" : d === 0 ? "double" : "complex";
		},
		get isReal() {
			return this.kind === "real";
		},
		get isDouble() {
			return this.kind === "double";
		},
		get isComplex() {
			return this.kind === "complex";
		},
		get roots() {
			const { a, b, discriminant: d } = this;
			if (d < 0) return [];
			const r = Math.sqrt(d);
			return d === 0
				? [-b / (2 * a)]
				: [(-b - r) / (2 * a), (-b + r) / (2 * a)].sort((x, y) => x - y);
		},
		get x1() {
			return fmt(this.roots[0] ?? 0);
		},
		get x2() {
			return fmt(this.roots[1] ?? 0);
		},
		get realPart() {
			return fmt(-this.b / (2 * this.a));
		},
		get imaginaryPart() {
			return abs(Math.sqrt(-this.discriminant) / (2 * this.a));
		},
		get kindText() {
			return {
				real: "Δ > 0: two real roots, where the parabola crosses the x axis.",
				double: "Δ = 0: one double root, where the parabola touches the x axis.",
				complex: "Δ < 0: two complex conjugate roots; the parabola never meets the x axis.",
			}[this.kind];
		},
		// The equation's terms, as signs and magnitudes, leaving out what reads as nothing.
		get aShown() {
			return this.a === 1 ? "" : this.a === -1 ? "−" : fmt(this.a);
		},
		get hasB() {
			return this.b !== 0;
		},
		get bSign() {
			return this.b < 0 ? "−" : "+";
		},
		get bShown() {
			return Math.abs(this.b) === 1 ? "" : abs(this.b);
		},
		get hasC() {
			return this.c !== 0;
		},
		get cSign() {
			return this.c < 0 ? "−" : "+";
		},
		get cShown() {
			return abs(this.c);
		},
		get negB() {
			return fmt(-this.b);
		},
		get bFactor() {
			return factor(this.b);
		},
		get aFactor() {
			return factor(this.a);
		},
		get cFactor() {
			return factor(this.c);
		},
		get twoA() {
			return fmt(2 * this.a);
		},
		get dText() {
			return fmt(this.discriminant);
		},
		get sqrtD() {
			return fmt(Math.sqrt(Math.abs(this.discriminant)));
		},
		get aText() {
			return fmt(this.a);
		},
		get bText() {
			return fmt(this.b);
		},
		get cText() {
			return fmt(this.c);
		},
		f(x) {
			return this.a * x * x + this.b * x + this.c;
		},
		// The parabola over x in [-10, 10], in plot coordinates (y up, clipped).
		get curve() {
			const points = [];
			for (let i = 0; i <= 200; i++) {
				const x = -10 + i / 10;
				const y = Math.max(-40, Math.min(40, this.f(x)));
				points.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${(-y).toFixed(2)}`);
			}
			return points.join(" ");
		},
		get rootPoints() {
			return this.roots.filter((x) => Math.abs(x) <= 10).map((x) => ({ cx: x, label: fmt(x) }));
		},
		get vertexX() {
			return -this.b / (2 * this.a);
		},
		get vertexY() {
			return -Math.max(-40, Math.min(40, this.f(this.vertexX)));
		},
		get presets() {
			return Object.keys(PRESETS);
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		div(
			{ class: "flex flex-wrap gap-2" },
			each(
				field("presets"),
				button(
					{
						class: "btn btn-xs",
						value: lookupBind("value"),
						"on:click": send("preset", targetValue()),
					},
					lookupBind("value"),
				),
			),
		),
		div(
			{ class: "grid gap-3 sm:grid-cols-3" },
			...["a", "b", "c"].map((name) =>
				label(
					{ class: "flex flex-col gap-1 text-sm" },
					span(
						{ class: "flex justify-between" },
						span({ class: "font-mono" }, name),
						span({ class: "tabular-nums" }, field(`${name}Text`)),
					),
					input({
						type: "range",
						min: "-10",
						max: "10",
						step: "0.5",
						class: "range range-sm",
						"aria-label": `Coefficient ${name}`,
						value: field(name),
						"on:input": send("setCoefficient", name, targetValue()),
					}),
				),
			),
		),
		div(
			{ class: "grid gap-4 lg:grid-cols-2" },
			div(
				{ class: "flex flex-col gap-4 text-lg" },
				section(
					"The equation",
					math(
						{ display: "block" },
						mrow(
							mrow(mn(field("aShown")), msup(mi("x"), mn("2"))),
							$if(field("hasB"), mrow(mo(field("bSign")), mn(field("bShown")), mi("x")), ""),
							$if(field("hasC"), mrow(mo(field("cSign")), mn(field("cShown"))), ""),
							mo("="),
							mn("0"),
						),
					),
				),
				section(
					"The quadratic formula, with these coefficients",
					math(
						{ display: "block" },
						mrow(
							mi("x"),
							mo("="),
							mfrac(
								mrow(
									mo("−"),
									mi("b"),
									mo("±"),
									msqrt(mrow(msup(mi("b"), mn("2")), mo("−"), mn("4"), mi("a"), mi("c"))),
								),
								mrow(mn("2"), mi("a")),
							),
							mo("="),
							mfrac(
								mrow(
									mn(field("negB")),
									mo("±"),
									msqrt(
										mrow(
											msup(mn(field("bFactor")), mn("2")),
											mo("−"),
											mn("4"),
											mo("·"),
											mn(field("aFactor")),
											mo("·"),
											mn(field("cFactor")),
										),
									),
								),
								mn(field("twoA")),
							),
						),
					),
				),
				section(
					"The discriminant",
					math(
						{ display: "block" },
						mrow(
							mi("Δ"),
							mo("="),
							msup(mi("b"), mn("2")),
							mo("−"),
							mn("4"),
							mi("a"),
							mi("c"),
							mo("="),
							mn(field("dText")),
						),
					),
					p({ class: "text-sm opacity-70" }, field("kindText")),
				),
				section(
					"The roots",
					$if(
						field("isReal"),
						math(
							{ display: "block" },
							mrow(
								msub(mi("x"), mn("1")),
								mo("="),
								mn(field("x1")),
								mo(","),
								mspace(),
								msub(mi("x"), mn("2")),
								mo("="),
								mn(field("x2")),
							),
						),
						$if(
							field("isDouble"),
							math({ display: "block" }, mrow(mi("x"), mo("="), mn(field("x1")))),
							math(
								{ display: "block" },
								mrow(
									mi("x"),
									mo("="),
									mn(field("realPart")),
									mo("±"),
									mn(field("imaginaryPart")),
									mi("i"),
								),
							),
						),
					),
				),
			),
			svg(
				{
					viewBox: "-10.5 -10.5 21 21",
					class: "w-full max-w-md rounded border border-base-300 bg-base-100",
					role: "img",
					"aria-label": "Plot of the parabola",
				},
				g(
					{ stroke: "currentColor", "stroke-opacity": "0.15", "stroke-width": "0.05" },
					...[-10, -5, 5, 10].flatMap((v) => [
						line({ x1: v, y1: -10, x2: v, y2: 10 }),
						line({ x1: -10, y1: v, x2: 10, y2: v }),
					]),
				),
				g(
					{ stroke: "currentColor", "stroke-opacity": "0.5", "stroke-width": "0.06" },
					line({ x1: -10, y1: 0, x2: 10, y2: 0 }),
					line({ x1: 0, y1: -10, x2: 0, y2: 10 }),
				),
				path({
					d: field("curve"),
					fill: "none",
					stroke: "#3f48cc",
					"stroke-width": "0.15",
					"stroke-linejoin": "round",
				}),
				circle({ cx: field("vertexX"), cy: field("vertexY"), r: "0.25", fill: "#a349a4" }),
				each(field("rootPoints"), circle({ cx: field("cx"), cy: "0", r: "0.35", fill: "#ed1c24" })),
			),
		),
	),
	on: {
		setCoefficient: {
			args: [t.enum("a", "b", "c"), t.string()],
			run(draft, [name, text]) {
				const n = Number(text);
				if (!Number.isFinite(n) || n < -20 || n > 20) return;
				if (name === "a" && n === 0) return; // Not a quadratic any more.
				draft[name] = n;
			},
		},
		preset: {
			args: [t.string()],
			run(draft, [name]) {
				const preset = PRESETS[name];
				if (preset !== undefined) [draft.a, draft.b, draft.c] = preset;
			},
		},
	},
});
function section(title, ...childs) {
	return div(
		{ class: "flex flex-col gap-1" },
		h3({ class: "text-xs font-semibold uppercase tracking-wider opacity-60" }, title),
		...childs,
	);
}
function mspace() {
	return tag.mspace({ width: "1em" });
}

const entry = () =>
	t
		.number()
		.int()
		.min(-9)
		.max(9)
		.arb((fc) => fc.integer({ min: -9, max: 9 }));
// A 2×2 matrix, its determinant and its inverse when it has one.
export const Matrix2 = component({
	name: "Matrix2",
	fields: {
		a: entry().default(2),
		b: entry().default(1),
		c: entry().default(1),
		d: entry().default(3),
	},
	methods: {
		get det() {
			return this.a * this.d - this.b * this.c;
		},
		get detText() {
			return fmt(this.det);
		},
		get isInvertible() {
			return this.det !== 0;
		},
		get aText() {
			return fmt(this.a);
		},
		get bText() {
			return fmt(this.b);
		},
		get cText() {
			return fmt(this.c);
		},
		get dText() {
			return fmt(this.d);
		},
		get negB() {
			return fmt(-this.b);
		},
		get negC() {
			return fmt(-this.c);
		},
		get products() {
			return `${factor(this.a)}·${factor(this.d)} − ${factor(this.b)}·${factor(this.c)}`;
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		div(
			{ class: "grid w-32 grid-cols-2 gap-1" },
			...["a", "b", "c", "d"].map((name) =>
				input({
					type: "number",
					min: "-9",
					max: "9",
					class: "input input-sm text-center tabular-nums",
					"aria-label": `Entry ${name}`,
					value: field(name),
					"on:input": send("setEntry", name, targetValue()),
				}),
			),
		),
		math(
			{ display: "block" },
			mrow(mi("A"), mo("="), matrix(["aText", "bText"], ["cText", "dText"])),
		),
		math(
			{ display: "block" },
			mrow(
				mo("det"),
				mi("A"),
				mo("="),
				mi("a"),
				mi("d"),
				mo("−"),
				mi("b"),
				mi("c"),
				mo("="),
				mtext(field("products")),
				mo("="),
				mn(field("detText")),
			),
		),
		$if(
			field("isInvertible"),
			math(
				{ display: "block" },
				mrow(
					msup(mi("A"), mrow(mo("−"), mn("1"))),
					mo("="),
					mfrac(mn("1"), mn(field("detText"))),
					matrix(["dText", "negB"], ["negC", "aText"]),
				),
			),
			p(
				{ class: "text-sm text-error" },
				"The determinant is 0, so A has no inverse: its columns are parallel.",
			),
		),
	),
	on: {
		setEntry: {
			args: [t.enum("a", "b", "c", "d"), t.string()],
			run(draft, [name, text]) {
				const n = Number(text);
				if (Number.isInteger(n) && n >= -9 && n <= 9) draft[name] = n;
			},
		},
	},
});
function matrix(...rows) {
	return mrow(
		mo("("),
		mtable(...rows.map((row) => mtr(...row.map((name) => mtd(mn(field(name))))))),
		mo(")"),
	);
}

// Classic formulas, each with a line about it.
export const FormulaGallery = component({
	name: "FormulaGallery",
	view: div(
		{ class: "grid gap-3 sm:grid-cols-2" },
		card(
			"Euler's identity",
			"Five constants, three operations.",
			mrow(msup(mi("e"), mrow(mi("i"), mi("π"))), mo("+"), mn("1"), mo("="), mn("0")),
		),
		card(
			"Pythagoras",
			"The sides of a right triangle.",
			mrow(
				msup(mi("a"), mn("2")),
				mo("+"),
				msup(mi("b"), mn("2")),
				mo("="),
				msup(mi("c"), mn("2")),
			),
		),
		card(
			"The Basel problem",
			"Euler again, in 1734.",
			mrow(
				munderover(mo("∑"), mrow(mi("n"), mo("="), mn("1")), mi("∞")),
				mfrac(mn("1"), msup(mi("n"), mn("2"))),
				mo("="),
				mfrac(msup(mi("π"), mn("2")), mn("6")),
			),
		),
		card(
			"The Gaussian integral",
			"The area under the bell curve.",
			mrow(
				msubsup(mo("∫"), mrow(mo("−"), mi("∞")), mi("∞")),
				msup(mi("e"), mrow(mo("−"), msup(mi("x"), mn("2")))),
				mi("d"),
				mi("x"),
				mo("="),
				msqrt(mi("π")),
			),
		),
		card(
			"The golden ratio",
			"A rectangle that keeps its shape when you cut a square off it.",
			mrow(
				mi("φ"),
				mo("="),
				mfrac(mrow(mn("1"), mo("+"), msqrt(mn("5"))), mn("2")),
				mo("≈"),
				mn("1.618"),
			),
		),
		card(
			"A derivative",
			"The slope of a curve at a point.",
			mrow(
				mfrac(mi("d"), mrow(mi("d"), mi("x"))),
				msup(mi("x"), mi("n")),
				mo("="),
				mi("n"),
				msup(mi("x"), mrow(mi("n"), mo("−"), mn("1"))),
			),
		),
	),
});
function card(title, text, formula) {
	return div(
		{ class: "flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4" },
		h3({ class: "text-sm font-semibold" }, title),
		math({ display: "block", class: "text-xl" }, formula),
		p({ class: "text-xs opacity-60" }, text),
	);
}

export const mathComponents = { Quadratic, Matrix2, FormulaGallery };
