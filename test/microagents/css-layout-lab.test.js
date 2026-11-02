import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "css-layout-lab";
const SAMPLES = ["empty", "holy-grail", "nav-bar"];

test("every sample but empty matches, and empty decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of SAMPLES.slice(1)) {
		const ids = registry.match(registry.sample(agent, id)).matches.map((m) => m.agent.id);
		assert.ok(ids.includes(ID), id);
	}
	assert.equal(registry.match(registry.sample(agent)).matches.length, 0);
	const { d } = drive(registry, agent);
	assert.equal(d.state.items.items.length, 0);
	assert.equal(d.state.containerId, "");
	d.send(ROOT, "add_items", []); // the add button makes the container too
	d.drain();
	assert.equal(d.state.items.items.length, 1);
	assert.equal(d.state.containerId, "container");
});

test("decode then encode gives back the same bytes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of SAMPLES) {
		const msg = registry.sample(agent, id);
		const root = registry.open(agent, msg);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg), id);
	}
});

test("the holy grail warns about a typo, and fixing the item clears it", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "holy-grail");
	assert.deepEqual(
		d.state.issues.map((i) => i.text),
		['aside: unknown property "algin-self": did you mean "align-self"?'],
	);
	const summary = d.state.layout_summary;
	assert.deepEqual([summary.columns, summary.rows], [3, 3]);
	assert.equal(
		summary.container["grid-template-areas"],
		'"header header header" "nav main aside" "footer footer footer"',
	);
	d.send(ROOT, "set_item_css", ["aside", "grid-area: aside;\nalign-self: start;"]);
	d.drain();
	assert.deepEqual(d.state.issues, []);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0], message.messages[0]);
	assert.equal(out.messages[4].data.get("css"), "grid-area: aside;\nalign-self: start;");
	assert.equal(out.messages[4].data.get("label"), "Aside");
	assert.equal(out.messages[4].meta, message.messages[4].meta);
	assert.ok(d.state.css.includes(".aside {\n  grid-area: aside;\n  align-self: start;\n}"));
});

test("the preview renders the container and item styles", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "nav-bar");
	const html = d.rootNode.innerHTML;
	assert.ok(html.includes("display: flex; justify-content: space-between; align-items: center"));
	assert.ok(html.includes("margin-left: auto;"));
});

test("container properties: set, replace, remove, and display", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "nav-bar");
	d.send(ROOT, "set_container_property", ["flex-direction", "column"]);
	d.send(ROOT, "set_container_property", ["gap", "2rem"]);
	d.send(ROOT, "set_container_property", ["padding", ""]);
	d.drain();
	assert.equal(
		d.state.containerCss,
		"justify-content: space-between;\nalign-items: center;\ngap: 2rem;\nflex-direction: column;",
	);
	d.send(ROOT, "set_select", [0, "grid"]); // the display control
	d.send(ROOT, "set_input", [1, "repeat(4, 1fr)"]);
	d.drain();
	assert.equal(d.state.display, "grid");
	assert.equal(d.state.layout_summary.columns, 4);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0].data.get("display"), "grid");
	assert.equal(out.messages[1], message.messages[1]);
});

test("the empty lab grows a container and items", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent);
	d.send(ROOT, "add_item", ["A", "grid-column: span 2;"]);
	d.send(ROOT, "add_item", ["", ""]);
	d.drain();
	d.send(ROOT, "remove_item", ["item-1"]);
	d.drain();
	assert.deepEqual(
		d.state.items.items.map((x) => `${x.id}:${x.label}`),
		["item-2:item-2"],
	);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.deepEqual(
		out.messages.map((m) => `${m.id}:${m.kind}`),
		["container:css-container", "item-2:css-item"],
	);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
});

test("tools: css, layout_summary, set_container_property, set_item_css, bad ids", async () => {
	const { call, text, env } = await toolRunner(ID, "holy-grail");
	assert.ok(
		text(await call("css")).startsWith(
			".container {\n  display: grid;\n  grid-template-columns: 12rem 1fr 10rem;",
		),
	);
	const summary = JSON.parse(text(await call("layout_summary")));
	assert.equal(summary.items.length, 5);
	const set = await call("set_container_property", { property: "gap", value: "1rem" });
	assert.equal(set.isError, false);
	assert.ok(text(set).includes("  gap: 1rem;"));
	const badProperty = await call("set_container_property", {
		property: "Not A Property",
		value: "1",
	});
	assert.equal(badProperty.isError, true);
	const badId = await call("set_item_css", { id: "nope", css: "flex: 1;" });
	assert.equal(badId.isError, true);
	assert.equal((await call("remove_item", { id: "nope" })).isError, true);
	const added = await call("add_item", { label: "Ad", css: "grid-column: 1 / -1;" });
	assert.ok(text(added).includes("/* Ad */\n.item-6 {\n  grid-column: 1 / -1;\n}"));
	assert.ok(env.root().summary.includes("grid · 6 items · 1 warnings"));
});

// The generated CSS is a plain-text JsonView: its Copy button asks the app to copy it, and its
// text follows the edits.
test("the generated CSS is a plain-text JsonView with a copy button", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "nav-bar");
	const copy = [...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Copy");
	assert.ok(copy);
	assert.equal(d.state.cssView.json, false);
	assert.equal(d.state.cssView.text, d.state.css);
	d.send(new Selector().field("cssView"), "copy", []);
	d.drain();
	d.send(ROOT, "set_container_property", ["gap", "2rem"]);
	d.drain();
	assert.ok(d.state.cssView.text.includes("gap: 2rem;"));
	assert.equal(d.state.cssView.text, d.state.css);
	assert.deepEqual(d.problems, []);
});

test("the chat shows set_container_property and set_item_css as CSS", async () => {
	const { call, agent } = await toolRunner(ID, "holy-grail");
	const line = async (name, tool, args) => {
		const result = await call(tool, args);
		const root = agent.scope.make(name, {
			call: { type: "toolCall", id: "x", name: tool, arguments: args },
			result,
			kind: "message",
		});
		const d = new Driver({ root, document });
		assert.deepEqual(d.problems, []);
		return d.rootNode.querySelector("summary").textContent;
	};
	assert.equal(
		await line("SetPropertyCall", "set_container_property", { property: "gap", value: "1rem" }),
		"messageset_container_propertygap: 1remno warnings",
	);
	assert.equal(
		await line("SetPropertyCall", "set_container_property", { property: "gapp", value: "1rem" }),
		"messageset_container_propertygapp: 1rem1 warning",
	);
	assert.equal(
		await line("SetPropertyCall", "set_container_property", { property: "gap", value: "" }),
		"messageset_container_propertygap removedno warnings",
	);
	assert.equal(
		await line("SetItemCssCall", "set_item_css", {
			id: "aside",
			css: "grid-area: aside;\nalgin-self: start;",
		}),
		"messageset_item_cssaside { grid-area: aside; algin-self: start; }1 warning",
	);
	assert.match(
		await line("SetItemCssCall", "set_item_css", { id: "nope", css: "flex: 1;" }),
		/^messageset_item_cssnope \{ flex: 1; \}.*precondition/,
	);
});

test("reorder_items moves an item: the preview, the CSS and the encoded parts follow", async () => {
	const { call, text, env, registry, agent, message } = await toolRunner(ID, "holy-grail");
	const moved = await call("reorder_items", { id: "footer", index: 0 });
	assert.equal(moved.isError, false);
	assert.ok(text(moved).includes("}\n/* Footer */\n.footer {"));
	assert.ok(text(moved).indexOf(".footer {") < text(moved).indexOf(".header {"));
	assert.equal((await call("reorder_items", { id: "nope", index: 0 })).isError, true);
	const ids = ["footer", "header", "nav", "main", "aside"];
	assert.deepEqual(
		env.root().items.items.map((x) => x.id),
		ids,
	);
	const out = registry.encode(agent, env.root(), message);
	assert.deepEqual(
		out.messages.map((m) => m.id),
		["page", ...ids],
	);
	assert.equal(out.messages[1], message.messages[5]);
});

test("the item list: drag to reorder, the remove button and the add button", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "holy-grail");
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="items"]');
	dispatchDrag(handles()[3], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(
		d.state.items.items.map((x) => x.id),
		["aside", "header", "nav", "main", "footer"],
	);
	const preview = d.rootNode.querySelector(".border-dashed").textContent;
	assert.ok(preview.startsWith("Aside"), preview);
	const remove = [...d.rootNode.querySelectorAll('button[title="Remove"]')];
	remove[1].click();
	d.drain();
	const add = [...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "+ Item");
	add.click();
	d.drain();
	assert.deepEqual(
		d.state.items.items.map((x) => `${x.id}:${x.label}`),
		["aside:Aside", "nav:Navigation", "main:Main", "footer:Footer", "item-5:item-5"],
	);
	assert.deepEqual(d.problems, []);
	assert.deepEqual(
		registry.encode(agent, d.state, message).messages.map((m) => m.id),
		["page", "aside", "nav", "main", "footer", "item-5"],
	);
});

test("css-layout-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});
