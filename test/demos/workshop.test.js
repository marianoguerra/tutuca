// The workshop (demos/workshop): an agent on the Shelf checks a component module's source
// there, defines it in the shelf's scope, adds one by name and defines it again, the one on the
// shelf moving onto the new definition with its state. All through the tree: its tools, the
// shelf's messages and the asks they make.
import assert from "node:assert/strict";
import test from "node:test";
import { pickName } from "../../components/trail/names.js";
import { start } from "../../demos/workshop/main.js";
import { STARTER } from "../../demos/workshop/shelf.js";
import { agentProblems } from "../../src/meta/index.js";
import { specOf } from "../../src/tutuca.js";
import { mountDemo } from "../helpers.js";

const twelfths = () => {
	let i = 0;
	return () => (i++ % 12) / 12;
};
const workshop = () => {
	const random = twelfths();
	const app = mountDemo(start, {
		askHandlers: { models: () => [], agentName: ([taken]) => pickName(taken, random) },
	});
	const document = app.window.document;
	const tour = app.host.tour;
	const drain = () => {
		while (tour.tasks.length > 0) tour.handleTasks();
	};
	const click = (el) => {
		el.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
		drain();
	};
	const rows = () => [...document.querySelectorAll("#path-tree .pt-row")];
	const say = async (text) => {
		const prompt = document.querySelector('textarea[aria-label="Prompt"]');
		prompt.value = text;
		prompt.dispatchEvent(new app.window.Event("input", { bubbles: true }));
		drain();
		const submit = new app.window.Event("submit", { bubbles: true, cancelable: true });
		document.querySelector("form.agent-prompt").dispatchEvent(submit);
		await tour.whenIdle();
		drain();
	};
	const results = () =>
		tour.root.agents[tour.root.current].transcript.messages
			.filter((m) => m.role === "toolResult")
			.map((m) => ({ text: m.content[0].text, isError: m.isError }));
	const tool = (name, args) => say(`/${name} ${JSON.stringify(args)}`);
	const addAgent = (index) => {
		click(rows()[index]);
		click(document.querySelector(".trail-add-agent"));
	};
	return { ...app, document, tour, drain, click, rows, say, tool, results, addAgent };
};

const BADGE = STARTER.replaceAll("Counter", "Badge");
const BROKEN = BADGE.replace("next.count += 1", "this.count += 1");
const RELABELED = BADGE.replace("count: number }", "count: number; tone: string }")
	.replace("count: 0 }", 'count: 0, tone: "badge" }')
	.replace(
		'span({ class: "text-sm opacity-70" }, field("label"))',
		'span({ class: field("tone") }, field("label"))',
	);

test("workshop: the probe's agent meta names messages and queries it has", () => {
	const app = workshop();
	const spec = app.tour.scope.lookupSpec("Probe");
	assert.deepEqual(agentProblems(spec), []);
});

test("workshop: an agent checks, defines, adds and defines again, from the shelf", async () => {
	const app = workshop();
	app.addAgent(0);
	const shelf = () => app.state();

	// What's wrong, where, and what to do instead.
	await app.tool("check_component", { source: BROKEN });
	const checked = app.results().at(-1);
	assert.equal(checked.isError, false);
	assert.match(checked.text, /^It doesn't check/);
	assert.match(checked.text, /error\[immutable-target\]: this is read-only here/);
	assert.match(checked.text, /--> line \d+, column \d+/);
	assert.match(checked.text, /= help: this is read-only: change next instead/);

	await app.tool("check_component", { source: BADGE });
	assert.equal(app.results().at(-1).text, "It checks: defines Badge.");
	assert.equal(app.host.scope.lookupSpec("Badge"), null, "checking defines nothing");

	await app.tool("send", { name: "define", args: [BADGE] });
	assert.match(app.results().at(-1).text, /^Sent\./);
	assert.equal(shelf().report, "Defined Badge.");
	assert.deepEqual(shelf().defined, ["Badge"]);
	assert.notEqual(app.host.scope.lookupSpec("Badge"), null);

	await app.tool("spec", {});
	assert.ok(JSON.parse(app.results().at(-1).text).makes.includes("Badge"));

	await app.tool("send", { name: "add", args: ["Badge", { label: "Stars", count: 3 }] });
	assert.equal(shelf().items.length, 2);
	assert.equal(shelf().items[1].count, 3);
	assert.match(app.rootNode.textContent, /Stars/);

	// A click on what it added runs as in any app.
	const badgeButton = [...app.rootNode.querySelectorAll("li button.btn-primary")][0];
	app.fire("click", badgeButton);
	assert.equal(shelf().items[1].count, 4);

	// A name that can't be made says what can.
	await app.tool("send", { name: "add", args: ["Nope", null] });
	assert.match(shelf().report, /^Can't add Nope: .*The shelf can make: Badge, Note, Shelf\./);

	// Defined again: the one on the shelf moves onto it, with its state.
	const before = shelf().items[1];
	await app.tool("check_component", { source: RELABELED });
	assert.match(app.results().at(-1).text, /gives Badge a new definition/);
	await app.tool("send", { name: "define", args: [RELABELED] });
	assert.match(
		shelf().report,
		/^Gave Badge a new definition.*\n {2}\.items\[1\]\.tone added, at its default/,
	);
	const after = shelf().items[1];
	assert.notEqual(specOf(after), specOf(before));
	assert.equal(after.count, 4);
	assert.equal(after.label, "Stars");
	assert.equal(after.tone, "badge");
	assert.ok(app.rootNode.querySelector("span.badge"), "renders with the new view");
	assert.deepEqual(shelf().defined, ["Badge"]);

	// And still works.
	app.fire("click", [...app.rootNode.querySelectorAll("li button.btn-primary")][0]);
	assert.equal(shelf().items[1].count, 5);

	// A module that doesn't check isn't defined, and the shelf says why.
	await app.tool("send", { name: "define", args: [BROKEN] });
	assert.match(shelf().report, /^Nothing was defined\.\n1 error, 0 warnings/);
	assert.equal(specOf(shelf().items[1]), app.host.scope.lookupSpec("Badge"));
	assert.deepEqual(app.problems, []);
});

test("workshop: a JavaScript component can be given a new definition too", async () => {
	const app = workshop();
	app.addAgent(0);
	const note = `import { field, p } from "tutuca/view";
export type Note = { text: string };
export const Note = { defaults: { text: "" }, view: p({ class: "font-bold" }, "📝 ", field("text")) };
`;
	await app.tool("send", { name: "define", args: [note] });
	assert.match(app.state().report, /^Gave Note a new definition/);
	assert.match(app.rootNode.textContent, /📝 Define a component/);
	assert.deepEqual(app.problems, []);
});
