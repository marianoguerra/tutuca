import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { addDays, dayHeader, dueLabel, dueTone, isIso } from "../components/todo/dates.js";
import { TODAY, todoAppArb } from "../components/todo/fixtures.js";
import { todoComponents } from "../components/todo/index.js";
import { parseQuickAdd } from "../components/todo/quickadd.js";
import { devComponents } from "../src/dev/panel.js";
import { arbitraries, specProperties } from "../src/test/pbt.js";
import { Scope } from "../src/tutuca.js";

const { document } = new JSDOM("").window;

test("due labels are relative to today", () => {
	const at = (n) => dueLabel(addDays(TODAY, n), TODAY);
	assert.deepEqual(
		[at(-1), at(0), at(1), at(3), at(7), at(80)],
		["Yesterday", "Today", "Tomorrow", "Monday", "Oct 23", "Jan 4 2027"],
	);
	assert.deepEqual(
		[-1, 0, 1, 3, 9].map((n) => dueTone(addDays(TODAY, n), TODAY)),
		["overdue", "today", "tomorrow", "week", "later"],
	);
	assert.equal(dayHeader(TODAY, TODAY), "Fri 16 Oct · Today");
	assert.equal(dayHeader(addDays(TODAY, 10), TODAY), "Mon 26 Oct");
});

test("isIso only accepts real dates", () => {
	assert.ok(isIso("2026-02-28"));
	assert.ok(!isIso("2026-02-30"));
	assert.ok(!isIso("2026-2-3"));
});

test("quick add parses dates, priority, project and labels", () => {
	const parse = (text) => parseQuickAdd(text, { today: TODAY, projects: ["Work", "Home"] });
	assert.deepEqual(parse("Buy milk tomorrow p1 #home @Shop @shop"), {
		title: "Buy milk",
		due: "2026-10-17",
		dueText: "tomorrow",
		priority: 1,
		project: "Home",
		labels: ["shop"],
	});
	assert.equal(parse("Call mom next week").due, "2026-10-19");
	assert.equal(parse("Gym in 3 days").due, "2026-10-19");
	assert.equal(parse("Report fri").due, TODAY);
	assert.equal(parse("Report mon").due, "2026-10-19");
	assert.equal(parse("Taxes 2027-04-15").due, "2027-04-15");
	// Only the first date counts; an unknown #project stays in the title.
	assert.deepEqual(parse("Read #Books today tomorrow"), {
		title: "Read #Books tomorrow",
		due: TODAY,
		dueText: "today",
		priority: 4,
		project: null,
		labels: [],
	});
	// Without today, as QuickAdd previews it: words kept, dates unresolved.
	assert.deepEqual(parseQuickAdd("x tom #Anything"), {
		title: "x",
		due: "",
		dueText: "tom",
		priority: 4,
		project: "Anything",
		labels: [],
	});
});

test("quick add never loses words", () => {
	fc.assert(
		fc.property(
			fc.array(fc.constantFrom("a", "b", "tod", "p2", "#Work", "@x", "next", "week")),
			(words) => {
				const text = words.join(" ");
				const r = parseQuickAdd(text, { today: TODAY, projects: ["Work"] });
				const kept = [r.title, r.dueText].join(" ").split(/\s+/).filter(Boolean).length;
				const tags = words.filter((w) => /^(p[1-4]|#Work|@x)$/.test(w)).length;
				assert.equal(kept + tags, words.length);
			},
		),
	);
});

const propertiesOf = (components, overrides) => {
	for (const [name, spec] of Object.entries(components)) {
		test(`${name} has the generic properties`, () => {
			const scope = new Scope(() => {});
			scope.register(components);
			const A = arbitraries({ fc, scope, overrides });
			for (const [propName, prop] of Object.entries(specProperties(spec, A, { document }))) {
				try {
					fc.assert(prop, { numRuns: 25 });
				} catch (error) {
					error.message = `${name}.${propName}: ${error.message}`;
					throw error;
				}
			}
		});
	}
};
propertiesOf(todoComponents, { TodoApp: todoAppArb });
propertiesOf(devComponents, {});
