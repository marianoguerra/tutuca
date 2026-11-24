// A pure-tutuca module's examples run: each component's C.examples, { start, steps }, made from
// start in a scope and driven step by step as an app would (the Driver, headless: messages that
// need a context run too), each expect comparing the fields and queries it names. Structured
// data only: define.js turns what failed into diagnostics.

import { problemLines } from "../core/host/records.js";
import { query } from "../core/model/contract.js";
import { specOf } from "../core/model/spec.js";
import { findInvalid } from "../core/model/validate.js";
import { Driver } from "../testing/driver.js";
import { jsonText, pathText } from "../tree/index.js";
import { plainOf } from "../tree/record.js";

// The value of key in c: a field's, or a query's (a getter or a call with no args).
const readKey = (c, key) => {
	const spec = specOf(c);
	if (Object.hasOwn(spec.fields, key)) return plainOf(c[key]);
	if (spec.queries?.[key] !== undefined) return plainOf(query(c, key));
	throw new Error(`${spec.name} has no field or query ${key}`);
};
const same = (a, b) => jsonText(a) === jsonText(b);

// Runs examples (componentModule's, of the component name) in scope. What each did: [{ name,
// ok, step, why, expected, actual, key }], step the index of the step that failed (null when
// making it from start did), why what went wrong in words, expected and actual for an expect.
export const runExamples = (examples, name, scope) =>
	examples.map((example) => {
		const fail = (step, why, more = {}) => ({ name: example.name, ok: false, step, why, ...more });
		let root;
		try {
			root = scope.make(name, example.start);
		} catch (error) {
			return fail(null, `${name} can't be made from its start: ${error.message}`);
		}
		// A value its type rejects is made its default: the example wouldn't start where it says.
		for (const [key, value] of Object.entries(example.start ?? {})) {
			const made = Object.hasOwn(specOf(root).fields, key) ? plainOf(root[key]) : undefined;
			if (!same(made, value)) {
				return fail(
					null,
					`${name} can't start from its start: ${key} ${jsonText(value)} isn't one its type allows (it was made ${jsonText(made)})`,
				);
			}
		}
		// Made, but not what its invariants allow.
		const invalid = findInvalid(root, null);
		if (invalid.length > 0) {
			const why = invalid.map((i) => `${pathText(i.path)} ${i.reason}`).join("; ");
			return fail(null, `${name} can't start from its start: ${why}`);
		}
		const driver = new Driver({ root });
		for (const [i, step] of example.steps.entries()) {
			if (typeof step?.send === "string") {
				const before = driver.reports.length;
				try {
					driver.send(step.send, Array.isArray(step.args) ? step.args : []);
				} catch (error) {
					return fail(i, `sending ${step.send} threw: ${error.message}`);
				}
				const problems = driver.problemsSince(before);
				if (problems.length > 0) {
					const why = problems.flatMap(problemLines).join("; ");
					return fail(i, `sending ${step.send} failed: ${why || "a problem was reported"}`);
				}
			}
			for (const [key, expected] of Object.entries(step?.expect ?? {})) {
				let actual;
				try {
					actual = readKey(driver.state, key);
				} catch (error) {
					return fail(i, error.message);
				}
				if (!same(actual, expected)) {
					return fail(i, `expected ${key} to be ${jsonText(expected)}, got ${jsonText(actual)}`, {
						key,
						expected,
						actual,
					});
				}
			}
		}
		return { name: example.name, ok: true, step: null, why: null };
	});
