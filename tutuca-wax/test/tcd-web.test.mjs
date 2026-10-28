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
	const text = counter.files[COUNTER].replace("component Board {", "component Board {\n    field broken: nope;");
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

// A scope's binds join the ones in place, but not value: renderIt still
// renders the loop's item, as in tutuca's JS, which drops value from them.
test("a scope can't bind value over the item renderIt renders", async () => {
	const main = "binds.tcd";
	const files = {
		[main]: `package tutuca:binds@0.1.0;
component Cell { field n: s32; view main = span(field(n)); }
component Row {
    field cells: list<Cell>;
    scope extra { value: string, label: string }
    view main = ul(each(field(cells), scope(extra, li(bind(label), render_it()))));
}
`,
	};
	const wax = `fn row_scope_extra(state: &row_state) -> &row_scope_extra_binds {
    {row_scope_extra_binds| value: gs_value, label: gs_cell };
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "binds.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const cells = [tw.runtime.make(scope, "Cell", { n: 1 }), tw.runtime.make(scope, "Cell", { n: 2 })];
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Row", { cells }), { dev: true }).mount();
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent), ["Cell1", "Cell2"]);
	assert.deepEqual(host.failures, []);
});

// What isn't a node renders as String writes it, as in tutuca's JS: a map as
// "[object Object]", a key of any kind as its text; a loop needs something to
// loop over, so null fails as Object.entries(null) throws.
test("values render and key as String writes them, and a loop over null fails", async () => {
	const main = "texts.tcd";
	const files = {
		[main]: `package tutuca:texts@0.1.0;
component Texts {
    field v: any;
    field xs: any;
    loop keyed { key: any }
    view main = div(p(field(v)), ul(each(loop: keyed, field(xs), li(bind(value)))));
}
`,
	};
	const wax = `fn texts_loop_keyed_key(state: &texts_state, key: &value, item: &value) -> &value {
    item;
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "texts.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const make = (v, xs) => tw.runtime.make(scope, "Texts", { v, xs });
	const host = tw.runtime.createHost(window.document, container, make({ a: 1 }, [true, 1.5, [1, null, 2]]), { dev: true }).mount();
	assert.equal(container.querySelector("p").textContent, "[object Object]");
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent), ["true", "1.5", "12"]);
	assert.deepEqual(host.failures, []);
	const nulls = tw.runtime.createHost(window.document, window.document.createElement("div"), make(null, null)).mount();
	assert.deepEqual(nulls.failures.map((e) => e.message), ["A loop source must be a list or a map"]);
});

// A constant value or checked is set as the property the vdom sets them as,
// each render, as optimize.js keeps them dynamic.
test("a constant value or checked is set as a property", async () => {
	const main = "inputs.tcd";
	const files = {
		[main]: `package tutuca:inputs@0.1.0;
component Inputs { view main = div(input(value: "draft"), input(type: "checkbox", checked: true)); }
`,
	};
	const res = tcd.build({ main, files, impls: [{ path: "inputs.wax", text: "" }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Inputs", {})).mount();
	const [text, box] = container.querySelectorAll("input");
	assert.equal(text.value, "draft");
	assert.equal(box.checked, true);
	assert.deepEqual(host.failures, []);
});

// namespace: makes the element, and what's in it, in that namespace, as
// tutuca's JS does: an SVG shape outside an svg element.
test("an element's namespace attribute makes it in that namespace", async () => {
	const main = "shapes.tcd";
	const files = {
		[main]: `package tutuca:shapes@0.1.0;
component Shapes { view main = g(namespace: "http://www.w3.org/2000/svg", circle(r: "1")); }
`,
	};
	const res = tcd.build({ main, files, impls: [{ path: "shapes.wax", text: "" }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Shapes", {})).mount();
	const svg = "http://www.w3.org/2000/svg";
	assert.equal(container.querySelector("g").namespaceURI, svg);
	assert.equal(container.querySelector("circle").namespaceURI, svg);
	assert.equal(container.querySelector("g").hasAttribute("namespace"), false);
});

// A task can leave an invariant broken for the tasks it queued; when the last
// of them fails, the queue is empty all the same, and the settled state is
// checked, as tutuca's JS checks it whenever the queue empties.
test("invariants are checked when the queue empties after a task that failed", async () => {
	const main = "gauge.tcd";
	const files = {
		[main]: `package tutuca:gauge@0.1.0;
component Gauge {
    field ok: bool = true;
    invariant fine: ok;
    ask count() -> s32;
    message spoil() changes ok emits ask count;
    view main = p("x");
}
ask_handler count() -> s32;
`,
	};
	const wax = `fn gauge_on_spoil(state: &gauge_state, ctx: &context) -> &gauge_state {
    gauge_ask_count(ctx);
    gauge_with_ok(state, 0);
}

fn gauge_reply_count_ok(state: &gauge_state, ctx: &context, reply: i32) -> &gauge_state {
    state;
}

// Not the s32 it's declared to reply with: the reply is rejected.
fn gauge_answer_count(ctx: &context) -> &value {
    value_ok(value_string(gs_x));
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "gauge.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Gauge", {}), { dev: true });
	host.send("spoil");
	assert.deepEqual(host.failures.map((e) => e.rejection?.message), ["count_reply_ok"]);
	assert.deepEqual(
		host.issues.map((i) => [i.type, i.settled, i.issues.map((x) => x.reason)]),
		[["stateInvalid", true, ["invariant:fine"]]],
	);
});

// An ask handler only answers: it reads the asker's context (its scope), and
// can log, but sending from it fails the ask, as tutuca's JS ask handlers get
// no context to send from.
test("an ask handler answers and logs, and can't send", async () => {
	const main = "oracle.tcd";
	const files = {
		[main]: `package tutuca:oracle@0.1.0;
component Oracle {
    field got: s32;
    ask good() -> s32;
    ask bad() -> s32;
    message ask_good() changes nothing emits ask good;
    message ask_bad() changes nothing emits ask bad;
    view main = p("x");
}
ask_handler good() -> s32;
ask_handler bad() -> s32;
`,
	};
	const wax = `fn oracle_on_ask_good(state: &oracle_state, ctx: &context) -> &oracle_state {
    oracle_ask_good(ctx);
    state;
}

fn oracle_on_ask_bad(state: &oracle_state, ctx: &context) -> &oracle_state {
    oracle_ask_bad(ctx);
    state;
}

fn oracle_reply_good_ok(state: &oracle_state, ctx: &context, reply: i32) -> &oracle_state {
    oracle_with_got(state, reply);
}

fn oracle_reply_bad_ok(state: &oracle_state, ctx: &context, reply: i32) -> &oracle_state {
    oracle_with_got(state, reply);
}

fn oracle_answer_good(ctx: &context) -> &value {
    ctx_log(ctx, value_string(gs_x));
    value_ok(value_int(1));
}

fn oracle_answer_bad(ctx: &context) -> &value {
    ctx_stop_next(ctx);
    value_ok(value_int(2));
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "oracle.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Oracle", {}));
	host.send("ask_good");
	host.send("ask_bad");
	assert.equal(tw.runtime.get(host.root(), "got"), 1);
	assert.deepEqual(host.logs, ["x"]);
	assert.deepEqual(host.failures.map((e) => e.message), ["An ask handler only answers, it can't send: bad"]);
});

// A component type is checked as tutuca's JS checks it, by the name the scope
// makes it by: where a Counter is loaded as Tally, a field of type Tally
// takes it.
test("a type loaded under another name is of that name", async () => {
	const main = "boxes.tcd";
	const files = {
		[main]: `package tutuca:boxes@0.1.0;
component Tally { field count: s32; view main = p(field(count)); }
component Box { field item: Tally; view main = div(render(field(item))); }
`,
	};
	const res = tcd.build({ main, files, impls: [{ path: "boxes.wax", text: "" }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope, { names: { Tally: null } });
	await tw.loadComponent(await readFile(new URL("dist/components/counter.wasm", root)), scope, { names: { Counter: "Tally" } });
	const item = tw.runtime.make(scope, "Tally", { count: 3 });
	assert.deepEqual(tw.runtime.issues(scope, "Box", { item }), []);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Box", { item }), { dev: true });
	assert.deepEqual(host.issues, []);
	assert.equal(tw.runtime.typeName(tw.runtime.get(host.root(), "item")), "Counter");
});

// tcd checks the event modifiers a view may write, and the runtime parses
// them: two lists, in two languages, that must name the same ones.
test("tcd and the runtime know the same event modifiers", async () => {
	const tcdList = (await read("tcd/check/views.mbt")).match(/pub let event_modifiers : Array\[String\] = \[([^\]]*)\]/)[1];
	const tcdMods = [...tcdList.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
	const imports = await read("src/imports.wax");
	const runtimeMods = [...imports.matchAll(/#\[import = "([a-z]+)"\]\s*const s_mod_\w+: &extern;/g)].map((m) => m[1]).sort();
	assert.ok(runtimeMods.length > 0);
	assert.deepEqual(tcdMods, runtimeMods);
});

// The constraints that read the component, a key of another field or a
// check of it, are checked when it's made too, once it has its fields: a
// required field that breaks one fails, another takes its default.
test("a key of another field, and a check, are checked when a component is made", async () => {
	const main = "picks.tcd";
	const files = {
		[main]: `package tutuca:picks@0.1.0;
component Pick {
    field items: list<string>;
    field selected: index<items>;
    field n: s32 = 2 where check(even);
    view main = p(field(n));
}
`,
	};
	const wax = `fn pick_check_even(state: &pick_state, v: i32) -> i32 {
    (v %s 2) == 0;
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "picks.wax", text: wax }], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	assert.deepEqual(tw.runtime.issues(scope, "Pick", { items: ["a", "b"], selected: 1, n: 4 }), []);
	assert.throws(() => tw.runtime.make(scope, "Pick", { items: ["a", "b"], selected: 2 }), /selected/);
	assert.deepEqual(tw.runtime.issues(scope, "Pick", { items: ["a"], selected: 0, n: 3 }), [{ field: "n", problem: "invalid" }]);
	assert.equal(tw.runtime.get(tw.runtime.make(scope, "Pick", { items: ["a"], selected: 0, n: 3 }), "n"), 2);
});
