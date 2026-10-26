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
	await page.waitForFunction(() => document.querySelectorAll(".demo").length === 6);
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
	if (!(await page.locator("#status").textContent()).includes("native")) throw new Error("not on the builtins");
	if (errors.length > 0) throw new Error(errors.join("; "));
	await page.close();
});
