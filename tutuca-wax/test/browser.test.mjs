// The suite in a real browser: serves this directory over HTTP, opens a page
// in Chromium with Playwright, loads the module there with fetch, and runs
// every case against the page's own DOM. One node:test test per case. Then a
// smoke test of the demos page.
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { chromium } from "playwright";
import { EXAMPLES } from "../playground/examples.js";
import { createStaticServer } from "../scripts/serve.mjs";
import { createStudioServer } from "../scripts/studio-server.mjs";
import { cases } from "./suite.mjs";

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>tutuca-wax vdom</title>
<script type="module">
	import { load } from "/js/tutuca-rt.js";
	import { prepare, run } from "/test/suite.mjs";
	const bytesOf = async (path) => new Uint8Array(await (await fetch("/dist/" + path + ".wasm")).arrayBuffer());
	const textOf = async (path) => (await fetch("/dist/" + path)).text();
	window.results = (async () => {
		const vdom = await load(new URL("/dist/tutuca-rt.wasm", location.href));
		const shared = await prepare(vdom, bytesOf, textOf);
		return { builtins: vdom.builtins, cases: await run({ vdom, window }, shared) };
	})();
</script>`;

let server;
let browser;
let report;

before(async () => {
	server = createStaticServer({ "/suite": PAGE });
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	browser = await chromium.launch();
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${server.address().port}/suite`);
	report = await page.evaluate(() => window.results).catch((error) => {
		throw new Error(`the page failed: ${error.message} ${errors.join("; ")}`);
	});
});

after(async () => {
	await browser?.close();
	server?.close();
});

test("Chromium supplies the js-string builtins and string constants", () => {
	if (!report.builtins) throw new Error("the module ran on the polyfills");
});

for (const { name } of cases) {
	test(name, () => {
		const result = report.cases.find((r) => r.name === name);
		if (!result) throw new Error("the page didn't run this case");
		if (!result.ok) throw new Error(result.error);
	});
}

test("the demos page loads its modules, and its Board and todos respond to input", async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${server.address().port}/demos/`);
	await page.waitForFunction(() => document.querySelectorAll(".demo").length === 10);
	const board = page.locator(".demo").nth(1);
	await board.locator(".stage button", { hasText: "add" }).click();
	await board.locator(".stage button", { hasText: "add" }).click();
	await board.locator(".stage .counter button", { hasText: "+" }).first().click();
	const state = JSON.parse(await board.locator("pre").textContent());
	if (JSON.stringify(state) !== JSON.stringify({ type: "Board", total: 1, counters: [1, 1] })) {
		throw new Error(`unexpected state: ${JSON.stringify(state)}`);
	}
	// The todos: type and add one, check an item, remove another.
	const todos = page.locator(".demo").nth(2);
	await todos.locator(".stage input:not([type])").fill("ship it");
	await todos.locator(".stage button", { hasText: "add" }).click();
	await todos.locator(".stage li").nth(1).locator("input[type=checkbox]").check();
	await todos.locator(".stage li").nth(2).locator("button", { hasText: "x" }).click();
	const todoState = JSON.parse(await todos.locator("pre").textContent());
	const texts = todoState.items.map((item) => `${item.text}:${item.done}`).join(",");
	if (texts !== "read the README:true,write a component:true,ship it:false" || todoState.remaining !== 1 || todoState.draft !== "") {
		throw new Error(`unexpected todos state: ${JSON.stringify(todoState)}`);
	}
	// A real drag, with its dataTransfer: the first todo onto the last.
	await todos.locator(".stage li").first().dragTo(todos.locator(".stage li").last());
	const dragged = JSON.parse(await todos.locator("pre").textContent()).items.map((item) => item.text).join(",");
	if (dragged !== "write a component,ship it,read the README") throw new Error(`unexpected order after a drag: ${dragged}`);
	// A hole lists what its scope chain can make and becomes the one picked.
	const layout = page.locator(".demo", { hasText: "Layouts: holes" });
	await layout.locator(".stage .hole button").click();
	// Not a studio: no new component in the list, no ✎ on the slots.
	if ((await layout.locator(".stage .hole-new, .stage .slot-edit").count()) !== 0) throw new Error("the demo's layout offers the studio's new component or edit");
	await layout.locator(".stage .choices button", { hasText: "Counter" }).click();
	const slots = JSON.parse(await layout.locator("pre").textContent()).slots.map((s) => s.type).join(",");
	if (slots !== "Counter") throw new Error(`unexpected layout slots: ${slots}`);
	// Used, not edited: no remove buttons, the counter still there.
	await layout.locator(".stage .screen-toggle").click();
	if ((await layout.locator(".stage .slot-remove").count()) !== 0) throw new Error("the layout's editing chrome shows while it's used");
	if (JSON.parse(await layout.locator("pre").textContent()).editing !== false) throw new Error("the screen didn't toggle to use");
	// Loading modules at run time: TodoList first, which can't make a
	// TodoItem until todo_item.wasm is loaded too.
	const loading = page.locator(".demo").first();
	await loading.locator(".actions button", { hasText: "load todo_list.wasm" }).click();
	await loading.locator(".stage input[placeholder]").fill("later");
	await loading.locator(".stage button", { hasText: "add" }).click();
	await loading.locator(".events li.failed", { hasText: "Can't make a component of type TodoItem" }).waitFor();
	await loading.locator(".actions button", { hasText: "load todo_item.wasm" }).click();
	await loading.locator(".events li", { hasText: "loaded todo_item.wasm" }).waitFor();
	await loading.locator(".stage button", { hasText: "add" }).click();
	// The other TodoItem takes the name over: the next item is a card.
	await loading.locator(".actions button", { hasText: "load todo_card.wasm" }).click();
	await loading.locator(".events li", { hasText: "loaded todo_card.wasm" }).waitFor();
	await loading.locator(".stage input[placeholder]").fill("card");
	await loading.locator(".stage .join button", { hasText: "add" }).click();
	await loading.locator(".stage li.todo-card .star").click();
	const loadingState = JSON.parse(await loading.locator("pre").textContent());
	const classes = await loading
		.locator(".stage li")
		.evaluateAll((lis) => lis.map((li) => ["todo", "todo-card"].filter((c) => li.classList.contains(c)).join(" ")).join());
	if (
		loadingState.modules.map((m) => m.file).join() !== "todo_list.wasm,todo_item.wasm,todo_card.wasm" ||
		loadingState.root.items.map((i) => `${i.text}:${i.starred ?? "-"}`).join() !== "later:-,card:true" ||
		classes !== "todo,todo-card"
	) {
		throw new Error(`unexpected loading state: ${classes} ${JSON.stringify(loadingState)}`);
	}
	// The JSON editor: edit, toggle the boolean, add an entry and make it a number.
	const json = page.locator(".demo").nth(4);
	await json.locator(".stage button", { hasText: "Edit" }).click();
	await json.locator(".stage button", { hasText: "true" }).click();
	// The document's own, after the nested deps' one.
	await json.locator(".stage button", { hasText: "+ entry" }).last().click();
	await json.locator(".stage [aria-label='Pick a type'] button[title=number]").click();
	// The state panel's pre comes after the editor's own.
	const jsonState = JSON.parse(await json.locator("pre").last().textContent());
	const expected = { name: "tutuca-wax", version: 2, wasm: false, tags: ["wax", "wasm-gc"], author: null, deps: {}, key7: 0 };
	if (jsonState.mode !== "edit" || JSON.stringify(jsonState.json) !== JSON.stringify(expected)) {
		throw new Error(`unexpected json state: ${JSON.stringify(jsonState)}`);
	}
	// SVG, MathML and a custom element, clicked for real.
	const demoState = async (i) => JSON.parse(await page.locator(".demo").nth(i).locator("pre").textContent());
	const dot = page.locator(".demo").nth(5);
	await dot.locator(".stage circle").click();
	await dot.locator(".stage svg text", { hasText: "+" }).click();
	if (JSON.stringify(await demoState(5)) !== JSON.stringify({ type: "Dot", r: 25, filled: true })) throw new Error(`unexpected dot: ${JSON.stringify(await demoState(5))}`);
	await page.locator(".demo").nth(6).locator(".stage math").click();
	if (JSON.stringify(await demoState(6)) !== JSON.stringify({ type: "Sum", n: 4, total: 10 })) throw new Error(`unexpected sum: ${JSON.stringify(await demoState(6))}`);
	// Locators pierce tw-rating's open shadow root.
	await page.locator(".demo").nth(7).locator(".stage tw-rating button[title='5 of 5']").click();
	if (JSON.stringify(await demoState(7)) !== JSON.stringify({ type: "Rating", stars: 5 })) throw new Error(`unexpected rating: ${JSON.stringify(await demoState(7))}`);
	if (!(await page.locator("#status").textContent()).includes("native")) throw new Error("not on the builtins");
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.close();
});

// The studio's library as kept in IndexedDB, by kind.
const studioRecords = (page, kind) =>
	page.evaluate(
		(kind) =>
			new Promise((resolve) => {
				const open = indexedDB.open("tutuca-wax-studio");
				open.onsuccess = () => {
					const all = open.result.transaction(kind).objectStore(kind).getAll();
					all.onsuccess = () => resolve(all.result);
				};
			}),
		kind,
	);

// A new screen from the tab bar's +: a scope added in the picker's tree
// under the root, and the screen made in it.
async function newStudioScreen(page, { scope, name }) {
	await page.locator(".st-new-screen").click();
	await page.locator("[aria-label='Add a scope in root']").click();
	await page.locator("[aria-label=\"New scope's name\"]").fill(scope);
	await page.locator("[aria-label=\"New scope's name\"]").press("Enter");
	await page.locator(".st-scope[aria-selected=true]", { hasText: scope }).waitFor();
	await page.locator("[aria-label=\"New screen's name\"]").fill(name);
	await page.locator("dialog button", { hasText: "Create" }).click();
	await page.locator(".st-tab [role=tab][aria-selected=true]", { hasText: name }).waitFor();
}

// A slot's ✎ or ×, clicked as a person would: its slot hovered first, at its
// corner (outside the slots inside it), which shows the slot's buttons.
async function clickSlotButton(button) {
	await button.locator("xpath=..").hover({ position: { x: 2, y: 2 } });
	await button.click();
}

// Files dropped on selector, as a person drags them from the desktop: each
// { name, bytes }.
const dropFiles = (page, files, selector = ".st-stage") =>
	page.evaluate(
		({ files, selector }) => {
			const data = new DataTransfer();
			for (const { name, bytes } of files) data.items.add(new File([new Uint8Array(bytes)], name));
			const target = document.querySelector(selector);
			target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
			target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
		},
		{ files, selector },
	);

// From a screen being edited, the editor on a new component (the hole's
// + new component), built and previewed.
async function newStudioComponent(page) {
	const stage = page.locator(".st-stage");
	await stage.locator(".hole button").click();
	await stage.locator(".hole-new").click();
	await page.locator(".st-editor-bar").waitFor();
	await page.locator(".st-preview h3", { hasText: "Tasks" }).waitFor();
}

test("the studio makes screens in scopes, writes components from a hole, registers them there, edits them in place, and keeps it all", async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const stage = page.locator(".st-stage");
	const tabTo = (name) => page.locator(".st-tab [role=tab]", { hasText: name }).click();
	await page.goto(`http://127.0.0.1:${server.address().port}/studio/`);
	// No screens yet; a first one, in a new scope a under the root.
	await page.locator("button", { hasText: "+ New screen" }).waitFor();
	await newStudioScreen(page, { scope: "a", name: "home" });
	// New, it's edited: the hole offers a new component; used, nothing of the studio's.
	await page.locator(".st-bar .screen-toggle[aria-pressed=true]").waitFor();
	await newStudioComponent(page);
	// Served as files only: no API, so no assistant.
	if (await page.locator("button", { hasText: "Assistant" }).isVisible()) throw new Error("an assistant without a server");
	// The preview works, and the inspectors show its state.
	await page.locator(".st-preview [aria-label='New task']").fill("try it");
	await page.locator(".st-preview button", { hasText: "add" }).click();
	await page.locator(".st-inspector-tab", { hasText: "State" }).click();
	await page.locator(".st-state", { hasText: "try it" }).waitFor();
	// Saved and registered in a: back on the screen, the hole's list has it.
	await page.locator("button", { hasText: "Save & register" }).click();
	await stage.locator(".choices button", { hasText: /^Tasks$/ }).click();
	// Being edited, it shows its layout_edit view; used, its main.
	await stage.locator("[aria-label=Title]").waitFor();
	await page.locator(".st-bar .screen-toggle").click();
	await stage.locator("[aria-label='New task']").fill("first");
	await stage.locator("[aria-label='New task']").press("Enter");
	await stage.locator("li", { hasText: "first" }).waitFor();
	const [scopeA] = (await studioRecords(page, "scopes")).filter((s) => s.name === "a");
	const [tasks] = await studioRecords(page, "components");
	if (tasks?.name !== "tasks" || scopeA.registrations.map((r) => r.component).join() !== tasks.id) throw new Error("tasks wasn't kept and registered in a");
	// The layout saves itself as it changes.
	const layoutOf = async () => (await studioRecords(page, "screens")).find((s) => s.name === "home").layout;
	// A new screen's layout is { $make: "Screen" } until it's first kept.
	for (let i = 0; i < 50 && (await layoutOf()).fields?.content?.fields?.items?.[0]?.$make !== "Tasks"; i++) await page.waitForTimeout(100);
	const layout = await layoutOf();
	const item = layout.fields.content.fields.items[0];
	if (item.$make !== "Tasks" || item.fields.items[0].text !== "first" || "studio" in layout.fields || "editing" in layout.fields) {
		throw new Error(`unexpected layout: ${JSON.stringify(layout)}`);
	}
	// ✎ on its slot: edited, saved, and the screen made again with it.
	await page.locator(".st-bar .screen-toggle").click();
	await clickSlotButton(stage.locator(".slot-edit").first());
	await page.locator(".st-editor-bar").waitFor();
	const tcd = await page.evaluate(async () => (await fetch("/studio/assistant/examples/tasks.tcd")).text());
	await page.locator(".st-editor .cm-content").click();
	await page.keyboard.press("ControlOrMeta+a");
	await page.keyboard.insertText(tcd.replace('placeholder: "Something to do"', 'placeholder: "What next?"'));
	await page.locator(".st-editor-bar button", { hasText: "Save" }).click();
	// Made again, it's used, not edited, and the ✎'s ask reached its slot.
	await stage.locator("[placeholder='What next?']").waitFor();
	await page.waitForTimeout(300);
	const failed = await page.locator(".st-events div", { hasText: /^failed/ }).allTextContents();
	if (failed.length > 0) throw new Error(failed.join("; "));
	await stage.locator("li", { hasText: "first" }).waitFor();
	await page.locator(".st-bar .screen-toggle").click();
	// A layout's own component doesn't open: only the ones made here.
	await stage.locator("[title='Add a slot below']").click();
	await stage.locator(".hole button").click();
	await stage.locator(".choices button", { hasText: /^Tabs$/ }).click();
	await clickSlotButton(stage.locator(".slot-edit").nth(1));
	await page.waitForFunction(() => /comes with the studio/.test(document.querySelector(".st-status")?.textContent ?? ""));
	// Reloaded: from IndexedDB, the tab open again, used, not edited.
	const reopen = async () => {
		await stage.locator("li", { hasText: "first" }).waitFor();
		if ((await stage.locator(".hole, .slot-edit, .hole-new").count()) !== 0) throw new Error("a reopened screen shows its editing chrome");
		if ((await stage.locator("[role=tab]").count()) !== 1) throw new Error("the new tabs don't show their one tab");
	};
	await page.waitForTimeout(500);
	await page.reload();
	await reopen();
	// A second screen, then back to the first.
	await newStudioScreen(page, { scope: "b", name: "other" });
	if ((await stage.locator("li", { hasText: "first" }).count()) !== 0) throw new Error("the second screen shows the first's");
	await tabTo("home");
	await reopen();
	// Exported, the library dropped, imported again.
	await page.locator(".st-menu [role=button]").click();
	const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".st-menu button", { hasText: /^Export$/ }).click()]);
	const bundle = await download.path();
	await page.evaluate(() => indexedDB.deleteDatabase("tutuca-wax-studio"));
	await page.reload();
	await page.locator("button", { hasText: "+ New screen" }).waitFor();
	await page.locator("[aria-label='Import a bundle or components']").setInputFiles(bundle);
	await page.waitForFunction(() => /imported/.test(document.querySelector(".st-status")?.textContent ?? ""));
	await tabTo("home");
	await reopen();
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.evaluate(() => indexedDB.deleteDatabase("tutuca-wax-studio"));
	await page.close();
});

test("a copy of the layout in a screen's scope hides root's there, and the other screens keep root's", async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const dialogs = [];
	page.on("dialog", (dialog) => {
		dialogs.push(dialog.message());
		dialog.accept();
	});
	const stage = page.locator(".st-stage");
	const status = (re) => page.waitForFunction((source) => new RegExp(source).test(document.querySelector(".st-status")?.textContent ?? ""), re.source);
	await page.goto(`http://127.0.0.1:${server.address().port}/studio/`);
	await page.locator("button", { hasText: "+ New screen" }).waitFor();
	await newStudioScreen(page, { scope: "a", name: "mine" });
	await page.locator(".st-bar .screen-toggle[aria-pressed=true]").waitFor();
	await stage.locator(".hole button").click();
	await stage.locator(".choices button", { hasText: /^Hbox$/ }).click();
	// layout, from the example, saved in a: its names hide root's there.
	await stage.locator(".hbox .hole button").click();
	await stage.locator(".hole-new").click();
	await page.locator(".st-preview h3", { hasText: "Tasks" }).waitFor();
	await page.locator(".st-examples").selectOption("layout");
	await status(/registers Screen, Hole, Hbox/);
	await page.locator("button", { hasText: "Save & register" }).click();
	await page.locator(".st-editor-bar").waitFor({ state: "detached" });
	if ((await studioRecords(page, "scopes")).find((s) => s.name === "a").registrations.length !== 1) throw new Error("layout wasn't registered in a");
	// The screen made again with a's layout: used, the Hbox kept.
	await page.locator(".st-bar .screen-toggle[aria-pressed=false]").waitFor();
	await page.locator(".st-bar .screen-toggle").click();
	// Only the hovered slot's buttons show: none until then, and the Hbox's
	// at its corner, where the hole's ✎ inside it stays hidden.
	const shown = () => stage.locator(".slot-edit").evaluateAll((bs) => bs.map((b) => getComputedStyle(b).opacity).join());
	await page.mouse.move(0, 0);
	if ((await shown()) !== "0,0") throw new Error(`slot buttons show without a hover: ${await shown()}`);
	await stage.locator(".slot-edit").first().locator("xpath=..").hover({ position: { x: 2, y: 2 } });
	if ((await shown()) !== "1,0") throw new Error(`hovering the Hbox's slot shows ${await shown()}`);
	// The Hbox's ✎ opens the copy, now the one a's screens make.
	await clickSlotButton(stage.locator(".slot-edit").first());
	await page.locator(".st-editor-bar").waitFor();
	if ((await page.locator("[aria-label='Component name']").inputValue()) !== "layout") throw new Error("the Hbox's ✎ didn't open a's layout");
	const tcd = await page.evaluate(async () => (await fetch("/components/layout/layout.tcd")).text());
	await page.locator(".st-editor .cm-content").click();
	await page.keyboard.press("ControlOrMeta+a");
	await page.keyboard.insertText(tcd.replace('view main = div(class: "hbox flex', 'view main = div(class: "hbox hbox-mine flex'));
	await page.locator(".st-editor-bar button", { hasText: "Save" }).click();
	await stage.locator(".hbox-mine").waitFor();
	// The ✎'s ask, answered by the save, reaches the Hbox though the screen
	// is made again: nothing failed.
	await page.waitForTimeout(300);
	const failed = await page.locator(".st-events div", { hasText: /^failed/ }).allTextContents();
	if (failed.length > 0) throw new Error(failed.join("; "));
	// A screen in root: root's Hbox, as it comes.
	await page.locator(".st-new-screen").click();
	await page.locator(".st-scope", { hasText: /^root/ }).click();
	await page.locator(".st-scope[aria-selected=true]", { hasText: /^root/ }).waitFor();
	await page.locator("[aria-label=\"New screen's name\"]").fill("theirs");
	await page.locator("dialog button", { hasText: "Create" }).click();
	await page.locator(".st-tab [role=tab][aria-selected=true]", { hasText: "theirs" }).waitFor();
	await stage.locator(".hole button").click();
	await stage.locator(".choices button", { hasText: /^Hbox$/ }).click();
	await page.locator(".st-bar .screen-toggle").click();
	await stage.locator(".hbox").waitFor();
	if ((await stage.locator(".hbox-mine").count()) !== 0) throw new Error("a screen in root uses a's Hbox");
	// In root, where layout is already, the same names can't be given again:
	// asked, the screen gets a scope of its own under root, and the copy is
	// registered there.
	await page.locator(".st-bar .screen-toggle").click();
	await stage.locator(".hbox .hole button").click();
	await stage.locator(".hole-new").click();
	await page.locator(".st-preview h3", { hasText: "Tasks" }).waitFor();
	await page.locator(".st-examples").selectOption("layout");
	await status(/registers Screen, Hole, Hbox/);
	await page.locator("button", { hasText: "Save & register" }).click();
	await page.locator(".st-editor-bar").waitFor({ state: "detached" });
	if (!dialogs.some((d) => /Give theirs a scope of its own, under root/.test(d))) throw new Error(`not asked to give theirs a scope: ${dialogs}`);
	const scopes = await studioRecords(page, "scopes");
	const own = scopes.find((s) => s.name === "theirs");
	const rootScope = scopes.find((s) => s.name === "root");
	if (own?.parent !== rootScope.id || own.registrations.length !== 1 || rootScope.registrations.length !== 1) throw new Error(`unexpected scopes: ${JSON.stringify(scopes)}`);
	if ((await studioRecords(page, "screens")).find((s) => s.name === "theirs").scope !== own.id) throw new Error("theirs wasn't moved to its scope");
	// Made again there, its Hbox kept, and the bar's toggle says it's used.
	await page.locator(".st-bar .screen-toggle[aria-pressed=false]").waitFor();
	await stage.locator(".hbox").waitFor();
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.evaluate(() => indexedDB.deleteDatabase("tutuca-wax-studio"));
	await page.close();
});

test("the editor starts a component from an example, a prebuilt module's sources too, and registers it as its own", async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const dialogs = [];
	page.on("dialog", (dialog) => {
		dialogs.push(dialog.message());
		dialog.accept();
	});
	const stage = page.locator(".st-stage");
	const examples = page.locator(".st-examples");
	await page.goto(`http://127.0.0.1:${server.address().port}/studio/`);
	await page.locator("button", { hasText: "+ New screen" }).waitFor();
	await newStudioScreen(page, { scope: "a", name: "home" });
	await page.locator(".st-bar .screen-toggle[aria-pressed=true]").waitFor();
	await newStudioComponent(page);
	// todo_item uses ../todo_list/todo_list.tcd: the prebuilt's, found by the path.
	await examples.selectOption("todo_item");
	await page.waitForFunction(() => /registers TodoItem/.test(document.querySelector(".st-status")?.textContent ?? ""));
	if ((await page.locator("[aria-label='Component name']").inputValue()) !== "todo_item") throw new Error("a new component doesn't take the example's name");
	// Unchanged since it was opened: nothing asked. Now it changed: asked first.
	if (dialogs.length !== 0) throw new Error(`asked before replacing unchanged sources: ${dialogs}`);
	await examples.selectOption("counter");
	await page.locator(".st-preview .counter").waitFor();
	if (dialogs.length !== 1) throw new Error(`not asked before replacing changed sources: ${dialogs}`);
	await page.locator(".st-preview .counter button", { hasText: /^\+$/ }).click();
	await page.locator(".st-preview .counter span", { hasText: "1" }).waitFor();
	// Saved and registered in a, as any component written here.
	await page.locator("button", { hasText: "Save & register" }).click();
	await stage.locator(".choices button", { hasText: /^Counter$/ }).click();
	await stage.locator(".counter").waitFor();
	const [scopeA] = (await studioRecords(page, "scopes")).filter((s) => s.name === "a");
	const [counter] = await studioRecords(page, "components");
	if (counter?.name !== "counter" || scopeA.registrations.map((r) => r.component).join() !== counter.id) throw new Error("counter wasn't kept and registered in a");
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.evaluate(() => indexedDB.deleteDatabase("tutuca-wax-studio"));
	await page.close();
});

test("a component exported as its .wasm carries its sources, and dropped on another library's screen is a component of it, registered in that screen's scope", async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("dialog", (dialog) => dialog.accept());
	const stage = page.locator(".st-stage");
	const status = (re) => page.waitForFunction((source) => new RegExp(source).test(document.querySelector(".st-status")?.textContent ?? ""), re.source);
	await page.goto(`http://127.0.0.1:${server.address().port}/studio/`);
	await page.locator("button", { hasText: "+ New screen" }).waitFor();
	await newStudioScreen(page, { scope: "a", name: "home" });
	await page.locator(".st-bar .screen-toggle[aria-pressed=true]").waitFor();
	await newStudioComponent(page);
	await page.locator(".st-examples").selectOption("todo_list");
	await status(/registers TodoList/);
	await page.locator("button", { hasText: "Save & register" }).click();
	await stage.locator(".choices button", { hasText: /^TodoList$/ }).waitFor();
	// Exported: a's own component, as its .wasm, its sources in it.
	await page.locator(".st-menu [role=button]").click();
	const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".st-menu button", { hasText: "Export components" }).click()]);
	if (download.suggestedFilename() !== "todo_list.wasm") throw new Error(`exported ${download.suggestedFilename()}`);
	const bytes = [...readFileSync(await download.path())];
	// Another library: dropped on a screen of scope b, it's registered there.
	await page.evaluate(() => indexedDB.deleteDatabase("tutuca-wax-studio"));
	await page.reload();
	await page.locator("button", { hasText: "+ New screen" }).waitFor();
	await newStudioScreen(page, { scope: "b", name: "away" });
	await page.locator(".st-bar .screen-toggle[aria-pressed=true]").waitFor();
	// A file that isn't a component's .wasm, dropped with it: refused, and said so.
	await dropFiles(page, [
		{ name: "todo_list.wasm", bytes },
		{ name: "notes.txt", bytes: [...new TextEncoder().encode("hi")] },
	]);
	await page.locator(".st-toast-success", { hasText: "Imported into b" }).filter({ hasText: "todo_list: TodoList" }).waitFor();
	await page.locator(".st-toast-error", { hasText: "1 not imported" }).filter({ hasText: "notes.txt: only components' .wasm files import here" }).waitFor();
	// b gives no TodoItem for it to make: said so, in a toast and the events.
	await page.locator(".st-toast-warning", { hasText: "todo_list needs a TodoItem to make, which b doesn't give" }).waitFor();
	await page.locator(".st-events div", { hasText: "todo_list needs a TodoItem to make, which b doesn't give" }).waitFor({ state: "attached" });
	// The bar still says what was imported once the screen is made again.
	await page.locator(".st-bar .screen-toggle[aria-pressed=false]").waitFor();
	await status(/imported into b: todo_list \(TodoList\)/);
	// A toast goes when clicked.
	await page.locator(".st-toast-error").click();
	await page.locator(".st-toast-error").waitFor({ state: "detached" });
	const [todoList] = await studioRecords(page, "components");
	const tcd = await page.evaluate(async () => (await fetch("/components/todo_list/todo_list.tcd")).text());
	if (todoList?.name !== "todo_list" || todoList.tcd !== tcd || !todoList.wax.includes("todo_list_on_add_todo")) throw new Error("todo_list wasn't kept with its sources");
	const scopeB = (await studioRecords(page, "scopes")).find((s) => s.name === "b");
	if (scopeB.registrations.map((r) => r.component).join() !== todoList.id) throw new Error("todo_list wasn't registered in b");
	// Made again with it, used: edited, a hole there makes it. A prebuilt
	// module's .wasm imports too, from the menu.
	await page.locator(".st-bar .screen-toggle").click();
	await stage.locator(".hole button").click();
	await stage.locator(".choices button", { hasText: /^TodoList$/ }).click();
	await stage.locator(".todos").waitFor();
	await page.locator("[aria-label='Import a bundle or components']").setInputFiles(new URL("../dist/components/todo_item.wasm", import.meta.url).pathname);
	await status(/imported into b: todo_item \(TodoItem\)/);
	await page.locator(".st-bar .screen-toggle").click();
	await stage.locator("input[placeholder='What needs doing?']").fill("dropped");
	await stage.locator("input[placeholder='What needs doing?']").press("Enter");
	await stage.locator("li", { hasText: "dropped" }).waitFor();
	// Nothing failed but the text file, refused on purpose.
	const failed = (await page.locator(".st-events div", { hasText: /^failed/ }).allTextContents()).filter((e) => !e.includes("notes.txt"));
	if (failed.length > 0) throw new Error(failed.join("; "));
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.evaluate(() => indexedDB.deleteDatabase("tutuca-wax-studio"));
	await page.close();
});

test("kanban.wasm, dropped on a screen, is a board whose cards drag between lanes, and in a tab its panel's ✎ is the one shown", async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const stage = page.locator(".st-stage");
	await page.goto(`http://127.0.0.1:${server.address().port}/studio/`);
	await page.locator("button", { hasText: "+ New screen" }).waitFor();
	const bytes = [...readFileSync(new URL("../dist/components/kanban.wasm", import.meta.url))];
	// With no screen to register it in, the drop is taken and refused, and says why.
	await dropFiles(page, [{ name: "kanban.wasm", bytes }], "main");
	await page.locator(".st-toast-error", { hasText: "open a screen first" }).waitFor();
	if ((await studioRecords(page, "components")).length !== 0) throw new Error("a drop with no screen imported something");
	await newStudioScreen(page, { scope: "a", name: "board" });
	await page.locator(".st-bar .screen-toggle[aria-pressed=true]").waitFor();
	await dropFiles(page, [{ name: "kanban.wasm", bytes }]);
	await page.locator(".st-bar .screen-toggle[aria-pressed=false]").waitFor();
	await page.locator(".st-bar .screen-toggle").click();
	// In a tab: hovering the board shows only its panel's ✎, the nearest
	// slot's, and the tabs' own slot shows its ✎ over their header.
	await stage.locator(".hole button").click();
	await stage.locator(".choices button", { hasText: /^Tabs$/ }).click();
	await stage.locator(".tabs-box .hole button").click();
	await stage.locator(".choices button", { hasText: /^Kanban$/ }).click();
	const shown = () => stage.locator(".slot-edit").evaluateAll((bs) => bs.map((b) => `${b.closest(".tab-panel") ? "panel" : "tabs"} ${getComputedStyle(b).opacity}`).join(", "));
	await stage.locator(".kanban-lane").first().hover();
	if ((await shown()) !== "panel 1, tabs 0") throw new Error(`hovering the board shows ${await shown()}`);
	await stage.locator(".tabs-box [role=tablist]").hover({ position: { x: 300, y: 10 } });
	if ((await shown()) !== "panel 0, tabs 1") throw new Error(`hovering the tabs' header shows ${await shown()}`);
	await page.locator(".st-bar .screen-toggle").click();
	const lanes = () => stage.locator(".kanban-lane").evaluateAll((ls) => ls.map((l) => [...l.querySelectorAll(".kanban-text")].map((t) => t.textContent).join("|")));
	const expectLanes = async (want, what) => {
		const got = await lanes();
		if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: ${JSON.stringify(got)}`);
	};
	const card = (text) => stage.locator(".kanban-card", { hasText: text });
	await card("Write the .tcd").waitFor();
	// Onto a lane: at its end. Onto a card: before it, from another lane.
	await card("Drop a .wasm").dragTo(stage.locator(".kanban-lane[data-lane=doing] h3"));
	await card("Export the board").dragTo(card("Write the .tcd"));
	await expectLanes(["Cards forget their lane", "Drag cards between lanes|Drop a .wasm on a screen", "Export the board|Write the .tcd"], "after the drags");
	// Added to the first lane, then over Doing's limit of 2.
	await stage.locator(".kanban-draft").fill("A new idea");
	await stage.locator(".kanban-draft").press("Enter");
	await card("A new idea").dragTo(card("Drag cards between"));
	await expectLanes(["Cards forget their lane", "A new idea|Drag cards between lanes|Drop a .wasm on a screen", "Export the board|Write the .tcd"], "after adding");
	if ((await stage.locator(".kanban-lane.over .kanban-count").textContent()) !== "3/2") throw new Error("Doing doesn't say it's over its limit");
	// Tagged, removed, and the progress counts the last lane's.
	await card("A new idea").locator(".kanban-tag").click();
	await card("A new idea").locator(".kanban-tag", { hasText: "bug" }).waitFor();
	await card("Cards forget").hover();
	await card("Cards forget").locator(".kanban-remove").click();
	await card("Cards forget").waitFor({ state: "detached" });
	if ((await stage.locator(".kanban-progress").textContent()) !== "2 of 5 done") throw new Error(`progress: ${await stage.locator(".kanban-progress").textContent()}`);
	// The board's notify stops there: nothing unhandled or failed.
	const events = await page.locator(".st-events div").allTextContents();
	if (events.some((e) => /^(failed|info: unhandled)/.test(e))) throw new Error(events.join("; "));
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.evaluate(() => indexedDB.deleteDatabase("tutuca-wax-studio"));
	await page.close();
});

test("served with an API, the studio's assistant edits a component, and is told why what it wrote doesn't build until it does", async () => {
	// A scripted model (pi-ai's faux provider): its first try lacks a
	// function, its second adds it.
	const models = createModels();
	const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-coder", name: "Faux coder" }] });
	models.setProvider(faux.provider);
	const clicker = EXAMPLES.find((e) => e.id === "clicker");
	const tcd = clicker.sources[clicker.main]
		.replace("    message reset()", "    message double() changes count, best;\n    message reset()")
		.replace('button(class: "btn btn-sm btn-ghost", on_click: send(reset), "reset")', 'button(class: "btn btn-sm", on_click: send(double), "×2"),\n        button(class: "btn btn-sm btn-ghost", on_click: send(reset), "reset")');
	const wax = `${clicker.sources[clicker.impl]}
fn clicker_on_double(state: &clicker_state, ctx: &context) -> &clicker_state {
    let count = state.count * 2;
    let best = state.best;
    if count >s best {
        best = count;
    }
    {clicker_state| count, best };
}
`;
	const told = [];
	const system = (context) => context.messages.find((m) => m.role === "system");
	const textOf = (m) => (typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join(""));
	faux.setResponses([
		(context) => {
			told.push({ prompt: textOf(system(context)), tools: (system(context).toolsAdded ?? []).map((t) => t.name) });
			return fauxAssistantMessage([fauxText("Adding a ×2 button."), fauxToolCall("write_component", { tcd })], { stopReason: "toolUse" });
		},
		(context) => {
			const last = context.messages.at(-1);
			told.push({ result: last.role === "toolResult" && last.isError ? textOf(last) : null });
			return fauxAssistantMessage([fauxText("And its handler."), fauxToolCall("write_component", { wax })], { stopReason: "toolUse" });
		},
	]);
	// The faux model isn't one studio-models.mjs offers: offer it anyway.
	const studio = createStudioServer({ models, offer: () => true });
	await new Promise((resolve) => studio.listen(0, "127.0.0.1", resolve));
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const status = (re) => page.waitForFunction((source) => new RegExp(source).test(document.querySelector(".st-status")?.textContent ?? ""), re.source);
	try {
		await page.goto(`http://127.0.0.1:${studio.address().port}/studio/`);
		await newStudioScreen(page, { scope: "a", name: "home" });
		await newStudioComponent(page);
		await page.locator("button", { hasText: "Assistant" }).click();
		if ((await page.locator(".st-model").inputValue()) !== "faux/faux-coder") throw new Error("the model offered isn't the faux one");
		await page.locator(".st-chat-input").fill("Add a button that doubles the count");
		await page.locator(".st-chat button", { hasText: "Send" }).click();
		await page.locator(".st-chat-ok", { hasText: "It built: tasks registers Clicker" }).waitFor();
		// Done: no bubble saying it's still thinking.
		await page.locator(".st-chat-thinking").waitFor({ state: "detached" });
		// What the model was told: the reference, the examples, the module as
		// it was, the tool; then why its first try didn't build.
		const [first, second] = told;
		for (const part of ["# The .tcd language", "## Example: checklist", "## Example: tasks", "fn list_push(", "# The module you're editing: tasks", "message bump(at: index<items>)"]) {
			if (!first.prompt.includes(part)) throw new Error(`the system prompt lacks ${part}`);
		}
		if (first.tools.join() !== "write_component") throw new Error(`tools: ${first.tools}`);
		if (!/clicker_on_double/.test(second.result ?? "")) throw new Error(`the failed build's result: ${second.result}`);
		// The transcript shows both tries, and the preview has the button.
		if ((await page.locator(".st-chat-error", { hasText: "it didn't build" }).count()) !== 1) throw new Error("the failed try isn't shown");
		await page.locator(".st-preview button", { hasText: "×2" }).waitFor();
		// Kept, chat and all, once it's saved.
		if ((await studioRecords(page, "components")).length !== 0) throw new Error("a new component was kept before it was saved");
		await page.locator("button", { hasText: "Save & register" }).click();
		await status(/tasks registered in a/);
		const [kept] = await studioRecords(page, "components");
		if (!kept.tcd.includes("message double()") || !kept.wax.includes("fn clicker_on_double") || !kept.build.ok) throw new Error("the component wasn't kept as the model left it");
		if (kept.chat.map((m) => m.role).join() !== "user,assistant,toolResult,assistant,toolResult") throw new Error(`the transcript: ${kept.chat.map((m) => m.role)}`);
		if (errors.length > 0) throw new Error(errors.join("; "));
	} finally {
		await page.close();
		studio.close();
	}
});

test("the studio's assistant is shown the line each error points at, told when an error survived its change, and stopped when two tries leave the same errors", async () => {
	// A scripted model that writes the same mistake three times: an i32
	// compared with >=.
	const models = createModels();
	const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-coder", name: "Faux coder" }] });
	models.setProvider(faux.provider);
	const clicker = EXAMPLES.find((e) => e.id === "clicker");
	const wax = `${clicker.sources[clicker.impl]}
fn clicker_capped(state: &clicker_state) -> i32 {
    if state.count >= 10 {
        return 10;
    }
    state.count;
}
`;
	const results = [];
	const textOf = (m) => (typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join(""));
	const write = (context) => {
		const last = context.messages.at(-1);
		if (last.role === "toolResult") results.push(textOf(last));
		return fauxAssistantMessage([fauxText("Capping the count."), fauxToolCall("write_component", { tcd: clicker.sources[clicker.main], wax })], { stopReason: "toolUse" });
	};
	faux.setResponses([write, write, write, write]);
	const studio = createStudioServer({ models, offer: () => true });
	await new Promise((resolve) => studio.listen(0, "127.0.0.1", resolve));
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(`http://127.0.0.1:${studio.address().port}/studio/`);
		await newStudioScreen(page, { scope: "a", name: "home" });
		await newStudioComponent(page);
		await page.locator("button", { hasText: "Assistant" }).click();
		await page.locator(".st-chat-input").fill("Cap the count at 10");
		await page.locator(".st-chat button", { hasText: "Send" }).click();
		await page.locator(".st-chat", { hasText: "Stopped: the last two tries left the same errors" }).waitFor();
		await page.locator(".st-chat-thinking").waitFor({ state: "detached" });
		// Asked three times: told twice why, then stopped without a fourth try.
		if (results.length !== 2) throw new Error(`the model was told ${results.length} times`);
		const [first, second] = results;
		// The line the error points at, with carets under the operator, and the hint.
		if (!first.includes("|     if state.count >= 10 {") || !/\|\s+\^\^/.test(first)) throw new Error(`no excerpt: ${first}`);
		if (!first.includes("compare with <s <=s >s >=s")) throw new Error(`no hint: ${first}`);
		if (first.includes("there after your last change too")) throw new Error("the first try's error is marked as a repeat");
		if (!second.includes("there after your last change too")) throw new Error(`the repeat isn't marked: ${second}`);
		if (errors.length > 0) throw new Error(errors.join("; "));
	} finally {
		await page.close();
		studio.close();
	}
});

test("the playground compiles components in the browser, reports errors, adds missing functions, and composes with prebuilt modules", async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const base = `http://127.0.0.1:${server.address().port}/playground/`;
	const built = async () => {
		await page.waitForFunction(() => /built in|didn't build|failed/.test(document.querySelector(".pg-status")?.textContent ?? ""));
		return page.locator(".pg-status").textContent();
	};
	// Clicks a toolbar button that compiles, and resolves with the status after.
	const press = async (label) => {
		await page.evaluate(() => {
			document.querySelector(".pg-status").textContent = "";
		});
		await page.locator(".pg-toolbar button", { hasText: label }).click();
		return built();
	};
	const compile = () => press("Compile");
	const state = async () => JSON.parse(await page.locator(".pg-state").textContent());
	const tab = (name) => page.locator(".pg-tab-button", { hasText: new RegExp(`^${name.replace(".", "\\.")}$`) });
	await page.goto(`${base}?example=clicker`);
	if (!(await built()).startsWith("built in")) throw new Error(`clicker didn't build: ${await page.locator(".pg-diagnostics").textContent()}`);
	await page.locator(".pg-stage button", { hasText: "click" }).click();
	await page.locator(".pg-stage button", { hasText: "click" }).click();
	if (JSON.stringify(await state()) !== JSON.stringify({ $: "Clicker", count: 2, best: 2 })) throw new Error(`unexpected state: ${JSON.stringify(await state())}`);
	// The generated files are tabs too.
	for (const name of ["mine.contract.wax", "mine.glue.wax", "mine.abi.wax", "clicker.model.json"]) await tab(name).waitFor();
	// Test runs the model's example and random walks.
	await page.locator(".pg-toolbar button", { hasText: "Test" }).click();
	await page.locator(".pg-events div", { hasText: "example best_stays: passed" }).waitFor();
	await page.locator(".pg-events div", { hasText: "Clicker: 25 random walks found nothing" }).waitFor();
	// A type error in the .wax: a diagnostic at its line, and no module.
	await tab("clicker.wax").click();
	await page.locator(".cm-content").click();
	await page.keyboard.press("Control+End");
	await page.keyboard.type("\nfn clicker_oops() -> i32 { nope; }\n");
	const line = await page.locator(".cm-line").count();
	if (!(await compile()).startsWith("didn't build")) throw new Error("a broken .wax built");
	const diag = await page.locator(".pg-diagnostic").first().textContent();
	if (!diag.includes(`clicker.wax:${line - 1}:`) || !diag.includes("nope")) throw new Error(`unexpected diagnostic: ${diag}`);
	await page.locator(".cm-lintRange-error").first().waitFor();
	if (!(await press("Reset")).startsWith("built in")) throw new Error("Reset didn't build");
	// A new message in the .tcd lacks its function; Add missing functions writes it.
	await tab("clicker.tcd").click();
	await page.locator(".cm-line", { hasText: "message reset()" }).click();
	await page.keyboard.press("End");
	await page.keyboard.type("\nmessage halve() changes count;");
	if (!(await compile()).startsWith("didn't build")) throw new Error("a message without its function built");
	if (!(await page.locator(".pg-diagnostics").textContent()).includes("clicker_on_halve")) throw new Error("the missing function isn't reported");
	if (!(await press("Add missing functions")).startsWith("built in")) throw new Error(`didn't build after adding: ${await page.locator(".pg-diagnostics").textContent()}`);
	if (!(await page.locator(".cm-content").textContent()).includes("fn clicker_on_halve(state: &clicker_state, ctx: &context) -> &clicker_state")) {
		throw new Error("the stub wasn't added to the .wax");
	}
	// Composition: the compiled TodoCard in the prebuilt TodoList.
	await page.locator("select").first().selectOption("todo_card");
	await page.waitForFunction(() => document.querySelector(".pg-stage li.todo-card"));
	await page.locator(".pg-stage li.todo-card .star").first().click();
	const todos = await state();
	if (todos.$ !== "TodoList" || todos.items.map((i) => `${i.$}:${i.starred}`).join() !== "TodoCard:true,TodoCard:false") {
		throw new Error(`unexpected todos: ${JSON.stringify(todos)}`);
	}
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.close();
});
