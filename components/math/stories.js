import { step, stories } from "../../src/storybook/index.js";
import { mathComponents } from "./index.js";

const quadraticMessages = ["Quadratic.setCoefficient", "Quadratic.preset"];

export default stories({
	title: "Math",
	components: mathComponents,
	stories: {
		"Quadratic/Two roots": {
			make: (C) => C.Quadratic({ a: 1, b: -3, c: 2 }),
			sequences: {
				"roots 1 and 2": [
					step.check("Δ = 1", (s) => s.dText === "1" && s.isReal),
					step.check("x₁ = 1, x₂ = 2", (s) => s.x1 === "1" && s.x2 === "2"),
					step.check("both marked on the plot", (s) => s.rootPoints.length === 2),
				],
				"slide b until the roots meet": [
					step.event("input", '[aria-label="Coefficient b"]', { value: "-2" }),
					step.event("input", '[aria-label="Coefficient c"]', { value: "1" }),
					step.check("a double root at 1", (s) => s.isDouble && s.x1 === "1"),
					step.event("input", '[aria-label="Coefficient c"]', { value: "5" }),
					step.check(
						"then complex: 1 ± 2i",
						(s) => s.isComplex && s.realPart === "1" && s.imaginaryPart === "2",
					),
					step.check("and nothing on the axis", (s) => s.rootPoints.length === 0),
				],
				"a can't be zero": [
					step.send("setCoefficient", ["a", "0"]),
					step.check("still quadratic", (s) => s.a === 1),
				],
			},
			pbt: { include: quadraticMessages, maxCommands: 10 },
		},
		"Quadratic/Double root": { make: (C) => C.Quadratic({ a: 1, b: -4, c: 4 }) },
		"Quadratic/Complex roots": {
			make: (C) => C.Quadratic({ a: 1, b: 2, c: 5 }),
			sequences: {
				"−1 ± 2i": [
					step.check("conjugates", (s) => s.realPart === "−1" && s.imaginaryPart === "2"),
				],
			},
		},
		"Quadratic/Negative coefficients": {
			make: (C) => C.Quadratic({ a: -0.5, b: 1, c: 4 }),
			sequences: {
				"signs read right": [
					step.check("−0.5x²", (s) => s.aShown === "−0.5"),
					step.check("parenthesized in products", (s) => s.aFactor === "(−0.5)"),
					step.check("roots −2 and 4", (s) => s.x1 === "−2" && s.x2 === "4"),
				],
			},
		},
		"Quadratic/Presets": {
			make: (C) => C.Quadratic(),
			sequences: {
				"each preset": [
					step.event("click", 'button[value="complex roots"]'),
					step.check("complex", (s) => s.isComplex),
					step.event("click", 'button[value="double root"]'),
					step.check("double", (s) => s.isDouble),
				],
			},
			pbt: { events: true, maxCommands: 10 },
		},
		"Quadratic/Generated": {
			arbitrary: (A) => A.instance("Quadratic"),
			pbt: { include: quadraticMessages },
		},
		"Matrix/Invertible": {
			make: (C) => C.Matrix2(),
			sequences: {
				"det 5, then singular": [
					step.check("det = 5", (s) => s.det === 5 && s.isInvertible),
					step.event("input", '[aria-label="Entry d"]', { value: "1" }),
					step.event("input", '[aria-label="Entry a"]', { value: "1" }),
					step.check("det = 0", (s) => s.det === 0 && !s.isInvertible),
				],
			},
			pbt: { events: true, maxCommands: 10 },
		},
		"Matrix/Singular": { make: (C) => C.Matrix2({ a: 2, b: 4, c: 1, d: 2 }) },
		"Formula gallery": { make: (C) => C.FormulaGallery() },
	},
});
