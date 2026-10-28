// tcd in the browser, run in Node: dist/tcd/tcd.wasm (tcd and wax-mb's library
// compiled to wasm-gc) through js/tcd-web.js, as the playground's worker runs
// it. A module it builds from the repo's files is the one the native tcd
// builds, and behaves as it does; errors come back as diagnostics at their
// lines; stub lists what's missing.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { JSDOM } from "jsdom";
import { loadRuntimeFiles, loadTcd } from "../js/tcd-web.js";
import { examples } from "../js/pbt.js";
import { load } from "../js/tutuca-rt.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const COUNTER = "components/counter/counter.tcd";
const COUNTER_WAX = "components/counter/counter.wax";
let tcd;
let runtime;
let counter;

before(async () => {
	tcd = await loadTcd(new URL("dist/tcd/tcd.wasm", root));
	runtime = await loadRuntimeFiles(root);
	counter = { main: COUNTER, files: { [COUNTER]: await read(COUNTER) }, impls: [{ path: COUNTER_WAX, text: await read(COUNTER_WAX) }] };
});

test("tcd builds counter in wasm-gc, and the module behaves as the prebuilt one", async () => {
	const res = tcd.build({ ...counter, runtime });
	assert.deepEqual(res.diags, []);
	assert.equal(res.ok, true);
	assert.deepEqual(res.types, ["Counter", "Label", "Board"]);
	assert.match(res.glue, /fn counter_vt_handle: handle_fn/);
	// The same module the native tcd built (scripts/build.mjs).
	assert.ok(Buffer.from(res.wasm).equals(await readFile(new URL("dist/components/counter.debug.wasm", root))), "differs from the native build");
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Board", { counters: [], total: 0 }), { dev: true }).mount();
	const button = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);
	const click = (node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));
	click(button("add"));
	click(button("+"));
	assert.equal(tw.runtime.get(host.root(), "total"), 1);
	assert.deepEqual(host.issues, []);
	assert.deepEqual(host.failures, []);
});

test("a type error in the .wax comes back as a diagnostic at its line", () => {
	const text = `${counter.impls[0].text}\nfn counter_oops() -> i32 { nope; }\n`;
	const res = tcd.build({ ...counter, impls: [{ path: COUNTER_WAX, text }], runtime });
	assert.equal(res.ok, false);
	assert.equal(res.wasm, undefined);
	const line = text.split("\n").length - 1;
	const diag = res.diags.find((d) => d.span.file === COUNTER_WAX);
	assert.equal(diag.severity, "error");
	assert.equal(diag.span.start.line, line);
	assert.match(diag.message, /nope/);
});

test("errors in the .tcd stop before compiling; check reports them with the types", () => {
	const text = counter.files[COUNTER].replace("component board {", "component board {\n    field broken: nope;");
	const res = tcd.check({ ...counter, files: { [COUNTER]: text } });
	assert.equal(res.ok, false);
	assert.ok(res.diags.some((d) => d.severity === "error" && d.span.file === COUNTER && /nope/.test(d.message)));
	assert.equal(tcd.build({ ...counter, files: { [COUNTER]: text }, runtime }).contract, undefined);
});

test("stub lists the functions the implementation lacks; model is the package's model", () => {
	const impl = counter.impls[0].text.replace(/fn board_on_reset_all\(/, "fn board_on_reset_everything(");
	const res = tcd.stub({ ...counter, impls: [{ path: COUNTER_WAX, text: impl }] });
	assert.equal(res.ok, true);
	assert.match(res.stub, /fn board_on_reset_all\(state: &board_state, ctx: &context\) -> &board_state/);
	assert.doesNotMatch(res.stub, /fn counter_on_inc\(/);
	const { model } = tcd.model(counter);
	assert.deepEqual(
		model.components.map((c) => c.name),
		["Counter", "Label", "Board"],
	);
});

test("a use resolves relative to the main file, and a missing file is a diagnostic", async () => {
	const main = "components/todo_card/todo_card.tcd";
	const used = "components/todo_list/todo_list.tcd";
	const files = { [main]: await read(main), [used]: await read(used) };
	assert.equal(tcd.check({ main, files }).ok, true);
	const res = tcd.check({ main, files: { [main]: files[main] } });
	assert.ok(res.diags.some((d) => /can't read \.\.\/todo_list\/todo_list\.tcd/.test(d.message)));
	assert.equal(tcd.check({ main: "nowhere.tcd", files }).diags[0].message, "the request has no file nowhere.tcd");
});

// The studio assistant's examples (studio/assistant/examples/), which its
// system prompt shows the model as modules that build: they do, cleanly, and
// their examples hold.
test("the assistant's examples build without diagnostics, and their examples hold", async () => {
	const dir = "studio/assistant/examples/";
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	for (const name of ["note", "checklist", "stat"]) {
		const main = `${name}.tcd`;
		const res = tcd.build({ main, files: { [main]: await read(dir + main) }, impls: [{ path: `${name}.wax`, text: await read(`${dir}${name}.wax`) }], runtime });
		assert.deepEqual(res.diags, [], name);
		assert.equal(res.ok, true, name);
		const scope = tw.runtime.scope();
		await tw.loadComponent(res.wasm, scope);
		const ran = examples({ runtime: tw.runtime, scope, model: res.model });
		assert.ok(ran.length > 0, name);
		assert.deepEqual(ran.filter((e) => !e.ok).map((e) => e.name), [], name);
	}
});
