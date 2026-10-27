// The suite in a real browser: serves this directory over HTTP, opens a page
// in Chromium with Playwright, loads the module there with fetch, and runs
// every case against the page's own DOM. One node:test test per case. Then a
// smoke test of the demos page.
import test, { after, before } from "node:test";
import { chromium } from "playwright";
import { createStaticServer } from "../scripts/serve.mjs";
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
	await layout.locator(".stage .choices button", { hasText: "Counter" }).click();
	const slots = JSON.parse(await layout.locator("pre").textContent()).slots.map((s) => s.type).join(",");
	if (slots !== "Counter") throw new Error(`unexpected layout slots: ${slots}`);
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
