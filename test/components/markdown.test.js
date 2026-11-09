import assert from "node:assert/strict";
import test from "node:test";
import { canvas, canvasComponents } from "../../components/canvas/index.js";
import { droppedFile } from "../../components/common/files.js";
import { headingsOf, markdownComponents } from "../../components/markdown/index.js";
import { BUNDLES } from "../../demos/canvas/bundles.js";
import { lint } from "../../src/lint/index.js";
import {
	agentProblems,
	DATA_META,
	dataOf,
	dataProblems,
	fileFormatOf,
	JSON_FILE,
	loadData,
	summaryOf,
	withSample,
} from "../../src/meta/index.js";
import { Driver } from "../../src/testing/driver.js";
import { component, query, Scope, Selector, scopeOf, t } from "../../src/tutuca.js";
import { callTool, document, ranTool, scopeWith, tick } from "../helpers.js";

const C = () => scopeWith(markdownComponents).components;

test("markdown: its meta is sound and its data is its text, a .md file", () => {
	const md = C().Markdown({});
	assert.deepEqual(agentProblems(md), []);
	assert.deepEqual(dataProblems(md), []);
	assert.deepEqual(
		lint([markdownComponents.Markdown]).filter((i) => i.level === "error"),
		[],
	);
	const format = fileFormatOf(md);
	assert.equal(format.json, false);
	assert.equal(format.type, "text/markdown");
	assert.equal(format.extensions[0], ".md");
	const loaded = loadData(md, "# Hi\n").next;
	assert.equal(query(loaded, dataOf(md).data), "# Hi\n", "load(data) reads back as data");
	assert.match(loadData(md, { text: "x" }).error, /isn't/);
});

test("a data meta whose file is text, but whose load doesn't take a string, is a problem", () => {
	const file = { type: "text/plain", extensions: [".txt"] };
	const withLoad = (arg) =>
		component({
			name: "Doc",
			meta: { [DATA_META]: { load: "load", file } },
			fields: { text: t.string() },
			on: { load: { pure: true, args: [arg], run() {} } },
		});
	assert.deepEqual(dataProblems(withLoad(t.string())), []);
	assert.deepEqual(dataProblems(withLoad(t.any())), [
		"its data is a .txt file, but load doesn't take a string",
	]);
	assert.equal(fileFormatOf(withLoad(t.any())).type, "text/plain");
	const json = component({ name: "J", meta: { [DATA_META]: { load: "load" } }, on: {} });
	assert.equal(fileFormatOf(json), JSON_FILE);
});

test("markdown: the outline says its size, headings outside code, and how it starts", () => {
	assert.deepEqual(headingsOf("# A\n\n```\n# not one\n```\n## B\ntext\n####### seven"), [
		"# A",
		"## B",
	]);
	const md = C().Markdown({});
	assert.equal(summaryOf(md), "An empty markdown document.");
	const readme = withSample(md, "readme");
	assert.match(summaryOf(readme), /Headings:\n# Markdown\n## What it shows/);
	assert.match(summaryOf(readme), /words/);
});

test("markdown: an agent sets, appends to and replaces in its text", () => {
	let md = C().Markdown({});
	md = ranTool(md, "append_text", { text: "# Plan" });
	assert.equal(md.text, "# Plan");
	md = ranTool(md, "append_text", { text: "- one" });
	assert.equal(md.text, "# Plan\n\n- one");
	md = ranTool(md, "replace_text", { find: "one", replacement: "two" });
	assert.equal(md.text, "# Plan\n\n- two");
	const missing = callTool(md, "replace_text", { find: "three", replacement: "x" });
	assert.equal(missing.done.isError, true);
	assert.match(missing.done.text, /no "three"/);
	md = ranTool(md, "set_text", { text: "Done." });
	assert.equal(md.text, "Done.");
});

const startCanvas = (text = "# Notes\n") => {
	const comps = scopeWith(canvasComponents).components;
	const md = comps.Markdown({ text });
	return new Driver({ root: canvas(comps, [[40, 60, md, "📄 Notes"]]), document });
};
const card = (d) => d.rootNode.querySelector("foreignObject > .canvas-card");
const itemAt = (key) => new Selector().item("items", key);

test("markdown on a canvas: it renders in md-view, and its edit view is a textarea that writes it", () => {
	const d = startCanvas("# Hello");
	const view = card(d).querySelector("md-view");
	// Without the element defined (no browser), the renderer sets its content as an attribute.
	assert.equal(view.getAttribute("content"), "# Hello");
	card(d).querySelector('[aria-label="Edit it"]').click();
	d.drain();
	const area = card(d).querySelector('textarea[aria-label="Markdown"]');
	assert.equal(area.value, "# Hello");
	assert.notEqual(card(d).querySelector("md-view"), null, "a preview beside it");
	area.value = "# Changed";
	area.dispatchEvent(new document.defaultView.Event("input", { bubbles: true }));
	d.drain();
	assert.equal(d.state.items["item-1"].content.text, "# Changed");
	assert.equal(card(d).querySelector("md-view").getAttribute("content"), "# Changed");
	assert.deepEqual(d.problems, []);
});

test("markdown on a canvas: ⤓ downloads it as a .md file, and a dropped one loads as is", async () => {
	const d = startCanvas("# Notes\n\n- one\n");
	const saved = [];
	scopeOf(d.state).registerAskHandlers({ saveFile: (args) => saved.push(args) });
	card(d).querySelector('[aria-label="Download as .md"]').click();
	d.drain();
	await tick();
	assert.deepEqual(saved, [["notes.md", "# Notes\n\n- one\n", "text/markdown"]]);
	d.answer("readText", "ok", ["# Dropped\n"], { to: itemAt("item-1") });
	assert.equal(d.state.items["item-1"].content.text, "# Dropped\n");
	assert.equal(d.state.items["item-1"].dropError, "");
	assert.deepEqual(d.problems, []);
});

test("a drop carries the first file of the format, or says none is of it", () => {
	const format = fileFormatOf(C().Markdown({}));
	const drop = (...files) => ({ dataTransfer: { files } });
	const md = { name: "README.MD", type: "" };
	const png = { name: "x.png", type: "image/png" };
	assert.deepEqual(droppedFile(drop(png, md), format), { file: md });
	assert.deepEqual(droppedFile(drop({ name: "a", type: "text/markdown" }), format).file.name, "a");
	assert.deepEqual(droppedFile(drop(png), format), { error: "Not a .md file: x.png" });
	assert.deepEqual(droppedFile(drop(png)), { error: "Not a JSON file: x.png" });
	assert.equal(droppedFile(drop(), format), null);
});

test("every bundle's holes can become markdown, a builtin like the layouts", () => {
	for (const [id, bundle] of Object.entries(BUNDLES)) {
		const scope = new Scope();
		scope.registerMetaSchemas(bundle.metaSchemas);
		scope.register(bundle.components);
		const read = { scope, now: () => 0, uuid: () => "u" };
		const kinds = bundle.askHandlers.componentKinds([], read);
		const kind = kinds.find((k) => k.id === "markdown");
		assert.ok(kind, `${id} lists markdown`);
		assert.equal(kind.label, "📄 Markdown");
		assert.equal(kind.agent, true);
		assert.deepEqual(
			kind.samples.map((s) => s.id),
			["empty", "readme", "notes"],
		);
		const { content, width } = bundle.askHandlers.makeComponent(["markdown", "readme"], read);
		assert.match(content.text, /^# Markdown/, id);
		assert.equal(width, 520);
	}
});
