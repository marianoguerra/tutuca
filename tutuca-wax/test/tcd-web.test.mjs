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
import { CANVAS_META, componentMeta, DISPLAY_META, displayLabel, load } from "../js/tutuca-rt.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const COUNTER = "components/counter/counter.tcd";
const COUNTER_WAX = "components/counter/counter.wax";
// The well-known meta schemas the component modules use.
const META = "components/meta/meta.tcd";
let tcd;
let runtime;
let counter;

before(async () => {
	tcd = await loadTcd(new URL("dist/tcd/tcd.wasm", root));
	runtime = await loadRuntimeFiles(root);
	counter = { main: COUNTER, files: { [COUNTER]: await read(COUNTER), [META]: await read(META) }, impls: [{ path: COUNTER_WAX, text: await read(COUNTER_WAX) }] };
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
	const res = tcd.check({ ...counter, files: { ...counter.files, [COUNTER]: text } });
	assert.equal(res.ok, false);
	assert.ok(res.diags.some((d) => d.severity === "error" && d.span.file === COUNTER && /nope/.test(d.message)));
	assert.equal(tcd.build({ ...counter, files: { ...counter.files, [COUNTER]: text }, runtime }).contract, undefined);
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
	const files = { [main]: await read(main), [used]: await read(used), [META]: await read(META) };
	assert.equal(tcd.check({ main, files }).ok, true);
	const res = tcd.check({ main, files: { [main]: files[main], [META]: files[META] } });
	assert.ok(res.diags.some((d) => /can't read \.\.\/todo_list\/todo_list\.tcd/.test(d.message)));
	assert.equal(tcd.check({ main: "nowhere.tcd", files }).diags[0].message, "the request has no file nowhere.tcd");
});

// Modules whose examples are run here: the studio assistant's examples
// (studio/assistant/examples/), which its system prompt shows the model as
// modules that build, and the studio's own components (studio/studio.tcd).
// They build cleanly, and their examples hold.
test("the assistant's examples and the studio's module build without diagnostics, and their examples hold", async () => {
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const modules = [...["note", "checklist", "score", "stat", "tasks"].map((name) => `studio/assistant/examples/${name}`), "studio/studio"];
	for (const path of modules) {
		const name = path.split("/").pop();
		const main = `${name}.tcd`;
		const res = tcd.build({ main, files: { [main]: await read(`${path}.tcd`) }, impls: [{ path: `${name}.wax`, text: await read(`${path}.wax`) }], runtime });
		assert.deepEqual(res.diags, [], name);
		assert.equal(res.ok, true, name);
		const scope = tw.runtime.scope();
		await tw.loadComponent(res.wasm, scope);
		const ran = examples({ runtime: tw.runtime, scope, model: res.model });
		assert.ok(ran.length > 0, name);
		assert.deepEqual(ran.filter((e) => !e.ok).map((e) => e.name), [], name);
	}
});

// The tasks starter shows the model a reply that asks again (emits ask
// suggest), a view comparing a field with a literal, and a send of an item's
// field; here they run, rendered.
test("the tasks example asks again for an idea already in the list, and its views compare and send fields", async () => {
	const path = "studio/assistant/examples/tasks";
	const res = tcd.build({ main: "tasks.tcd", files: { "tasks.tcd": await read(`${path}.tcd`) }, impls: [{ path: "tasks.wax", text: await read(`${path}.wax`) }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Tasks", {}), { dev: true }).mount();
	const draft = () => tw.runtime.get(host.root(), "draft");
	// One item: taken 1 is "answer the email".
	host.send("set_draft", ["answer the email"], { now: true });
	host.send("add", [], { now: true });
	host.send("suggest_one", [], { now: true });
	await host.settled();
	assert.equal(draft(), "take a walk");
	host.send("set_draft", [""], { now: true });
	const again = [...container.querySelectorAll("button")].find((b) => b.textContent === "again");
	again.dispatchEvent(new window.Event("click", { bubbles: true }));
	await host.settled();
	assert.equal(draft(), "answer the email");
	assert.ok(!container.textContent.includes("some hidden"));
	host.send("set_show", ["open"], { now: true });
	await host.settled();
	assert.ok(container.textContent.includes("some hidden"));
	assert.deepEqual(host.issues, []);
	assert.deepEqual(host.failures, []);
});

// JS gives an integral number as an int: made with one, or sent one, where
// the type says f64 (here inside records in a list), a component holds a
// float, which its .wax reads as one.
test("an int where the type says f64 is held as a float, at any depth", async () => {
	const main = "points.tcd";
	const files = {
		[main]: `package tutuca:points@0.1.0;
component Points {
    field points: list<record { x: f64 }>;
    get total: f64;
    message add(p: record { x: f64 }) changes points;
    view main = span(field(total));
}
register Points;
example sums for Points {
    start { points: [{ x: 1 }] }
    send add({ x: 2 });
    expect total == 3;
}
`,
	};
	const wax = `fn points_get_total(state: &points_state) -> f64 {
    let total = 0.0;
    let i = 0;
    while i <s list_count(state.points) {
        total = total + (value_member(list_get(state.points, i)!, gs_x) as &value_float).value;
        i += 1;
    }
    total;
}

fn points_on_add(state: &points_state, ctx: &context, p: &value) -> &points_state {
    points_with_points(state, list_push(state.points, p));
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "points.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	assert.equal(tw.runtime.get(tw.runtime.make(scope, "Points", { points: [{ x: 1 }, { x: 2 }] }), "total"), 3);
	assert.deepEqual(
		examples({ runtime: tw.runtime, scope, model: res.model }).map((e) => [e.name, e.ok, e.failures]),
		[["sums", true, []]],
	);
});

// An ask's emits are what the handlers of its reply may do, checked in dev
// mode as a message's are; a reply without a handler is taken and changes
// nothing; an ask handler only answers.
test("an ask says what its reply's handlers may emit, and a reply needs no handler", async () => {
	const main = "asker.tcd";
	const source = (askHandlerEmits) => `package tutuca:asker@0.1.0;
component Asker {
    field n: s32;
    notify done();
    ask count() -> s32 emits nothing;
    ask ping() -> bool;
    message go() changes nothing emits ask count, ask ping;
    view main = p(field(n));
}
register Asker;
host_ask count;
host_ask ping;
${askHandlerEmits ? "ask_handler other() -> s32 emits nothing;" : ""}
`;
	const wax = `fn asker_on_go(state: &asker_state, ctx: &context) -> &asker_state {
    let _ = asker_ask_count(ctx);
    let _ = asker_ask_ping(ctx);
    state;
}

// Notifies, which its ask's emits nothing doesn't let it.
fn asker_reply_count_ok(state: &asker_state, ctx: &context, reply: i32) -> &asker_state {
    asker_notify_done(ctx);
    asker_with_n(state, reply);
}
`;
	assert.deepEqual(
		tcd.check({ main, files: { [main]: source(true) } }).diags.map((d) => d.code),
		["tcd.ask_handler.emits"],
	);
	const res = tcd.build({ main, files: { [main]: source(false) }, impls: [{ path: "asker.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Asker", {}), { dev: true, asks: { count: () => 3, ping: () => true } });
	host.send("go", [], { now: true });
	assert.equal(tw.runtime.get(host.root(), "n"), 3);
	// Asker is the root: its notify has no ancestor to handle it.
	assert.deepEqual(host.unhandled, ["done"]);
	assert.deepEqual(
		host.issues.map((i) => [i.type, i.message, i.issues]),
		[["messageInvalid", "count.ok", ["emits:notify:done"]]],
	);
});

// A view compares a value with a literal (field(x) == "a"); a send sends a
// field, the receiver's or, in an each body, the item's at the event's
// source key.
test("views compare a value with a literal, and sends send fields", async () => {
	const main = "picker.tcd";
	const files = {
		[main]: `package tutuca:picker@0.1.0;
component Picker {
    field items: list<record { id: string, label: string }>;
    field picked: string;
    field title: string = "fruit";
    field said: string;
    message pick(id: string) changes picked ensures next.picked == id;
    message say(text: string) changes said ensures next.said == text;
    view main = div(
        each(field(items),
            button(class: if(field(id) == "b", "is-b", "not-b"), "aria-pressed": field(id) != "a", on_click: send(pick, field(id)), field(label))),
        button(class: "say", on_click: send(say, field(title)), "say"),
        if(field(picked) == "b", span(class: "picked-b", "b!")));
}
register Picker;
`,
	};
	const wax = `fn picker_on_pick(state: &picker_state, ctx: &context, id: js_string) -> &picker_state {
    picker_with_picked(state, id);
}

fn picker_on_say(state: &picker_state, ctx: &context, text: js_string) -> &picker_state {
    picker_with_said(state, text);
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "picker.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	assert.deepEqual(
		tcd
			.check({ main, files: { [main]: files[main].replace('field(id) == "b"', 'field(id) == 3').replace("send(say, field(title))", "send(say, field(nope))") } })
			.diags.map((d) => d.code),
		["tcd.view.compare", "tcd.view.field"],
	);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const items = [
		{ id: "a", label: "Apple" },
		{ id: "b", label: "Banana" },
	];
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Picker", { items }), { dev: true }).mount();
	const buttons = () => [...container.querySelectorAll("button")];
	assert.deepEqual(
		buttons().slice(0, 2).map((b) => [b.className, b.getAttribute("aria-pressed")]),
		[
			["not-b", "false"],
			["is-b", "true"],
		],
	);
	buttons()[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.equal(tw.runtime.get(host.root(), "picked"), "b");
	assert.ok(container.querySelector(".picked-b"));
	container.querySelector(".say").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.equal(tw.runtime.get(host.root(), "said"), "fruit");
	assert.deepEqual(host.issues, []);
});

// An option of a component: render renders nothing while it's empty.
test("an empty option<component> renders nothing", async () => {
	const main = "opt.tcd";
	const files = {
		[main]: `package tutuca:opt@0.1.0;
component Child { field n: s32; view main = span(class: "child", field(n)); }
component Holder {
    field child: option<Child>;
    message open() changes child emits make Child;
    message close() changes child;
    view main = div(render(field(child)), if(field(child), p("has"), p("none")));
}
register Child, Holder;
`,
	};
	const wax = `fn holder_on_open(state: &holder_state, ctx: &context) -> &holder_state {
    holder_with_child(state, value_component(holder_make_child(ctx, 1)));
}

fn holder_on_close(state: &holder_state, ctx: &context) -> &holder_state {
    holder_with_child(state, value_null());
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "opt.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Holder", {}), { dev: true }).mount();
	const shown = () => container.textContent;
	assert.equal(shown(), "none");
	host.send("open", [], { now: true });
	assert.equal(shown(), "1has");
	host.send("close", [], { now: true });
	assert.equal(shown(), "none");
	assert.deepEqual(host.failures, []);
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
    {row_scope_extra_binds| value: gs_value, label: gs_Cell };
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

// A component's meta is what it says about itself to hosts, by URI, read from
// the module's tutuca section without compiling it.
test("a component's meta is in the module's tutuca section, by registered name and URI", async () => {
	const main = "card.tcd";
	const files = {
		[main]: `package tutuca:card@0.1.0;
component Card {
    meta "https://tutuca.dev/meta/canvas" = { title: "Card", icon: "🃏", width: 320, transparent: true };
    view main = p("card");
}
register Card;
`,
	};
	const res = tcd.build({ main, files, impls: [{ path: "card.wax", text: "" }], runtime });
	assert.deepEqual(res.diags, []);
	assert.deepEqual(componentMeta(res.wasm).meta, {
		Card: { "https://tutuca.dev/meta/canvas": { title: "Card", icon: "🃏", width: 320, transparent: true } },
	});
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	await tw.loadComponent(res.wasm, tw.runtime.scope()); // The runtime ignores it.
});

// A meta schema a module declares is registered in the scope it's loaded in:
// metaOf reads a type's meta over its defaults, and a type whose meta breaks
// it can't be registered there (a module tcd can't check it against, since
// it doesn't use the schema).
test("meta schemas fill defaults and refuse a meta that breaks them", async () => {
	const build = (main, text) => {
		const res = tcd.build({ main, files: { [main]: text }, impls: [{ path: main.replace(".tcd", ".wax"), text: "" }], runtime });
		assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
		return res.wasm;
	};
	const schemas = build(
		"schemas.tcd",
		`package tutuca:schemas@0.1.0;
meta_schema Sizes "urn:example:sizes" {
    field width: option<f64> where width >= 0;
    field wide: bool = true;
}
`,
	);
	assert.deepEqual(componentMeta(schemas).meta_schemas, ["urn:example:sizes"]);
	const card = build(
		"card.tcd",
		`package tutuca:card@0.1.0;
component Card { meta "urn:example:sizes" = { width: 3 }; view main = p("card"); }
component Bare { view main = p("bare"); }
register Card, Bare;
`,
	);
	const bad = build(
		"bad.tcd",
		`package tutuca:bad@0.1.0;
component Bad { meta "urn:example:sizes" = { width: -1, color: "red" }; view main = p("bad"); }
register Bad;
`,
	);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(schemas, scope);
	await tw.loadComponent(card, scope);
	assert.deepEqual(rt.metaSchema(scope, "urn:example:sizes").defaults, { width: null, wide: true });
	assert.deepEqual(rt.typeMetaOf(scope, "Card", "urn:example:sizes"), { width: 3, wide: true });
	assert.deepEqual(rt.typeMetaOf(scope, "Bare", "urn:example:sizes"), { width: null, wide: true });
	assert.deepEqual(rt.typeMetaOf(scope, "Card", "urn:example:other"), {});
	assert.equal(rt.typeMetaOf(scope, "Nope", "urn:example:sizes"), null);
	assert.deepEqual(rt.metaOf(rt.make(scope, "Card", {}), "urn:example:sizes"), { width: 3, wide: true });
	// hasMeta and metaShapeProblems, as tutuca's.
	assert.equal(rt.hasMeta(rt.make(scope, "Card", {}), "urn:example:sizes"), true);
	assert.equal(rt.hasMeta(rt.make(scope, "Bare", {}), "urn:example:sizes"), false);
	assert.deepEqual(rt.metaProblems(rt.make(scope, "Card", {}), "urn:example:sizes"), []);
	// A schema's fields say their defaults.
	assert.deepEqual(rt.metaSchema(scope, "urn:example:sizes").fields.map((f) => [f.name, f.default]), [
		["width", null],
		["wide", true],
	]);
	await assert.rejects(() => tw.loadComponent(bad, scope), /Bad's meta urn:example:sizes: it has no key color/);
});

// The layout's hole lists the types it can become by their display meta.
test("a hole's choices are labeled and described by their display meta", async () => {
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	for (const name of ["meta", "layout"]) await tw.loadComponent(await readFile(new URL(`dist/components/${name}.wasm`, root)), scope);
	assert.deepEqual(tw.runtime.typeMetaOf(scope, "Hbox", DISPLAY_META), {
		title: "Horizontal box",
		icon: "➡️",
		description: "Components side by side.",
	});
	assert.deepEqual(tw.runtime.typeMetaOf(scope, "Hole", CANVAS_META), { width: 240, height: null, transparent: true });
	assert.equal(displayLabel(tw.runtime.typeMetaOf(scope, "Vbox", DISPLAY_META)), "⬇️ Vertical box");
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Screen", { editing: true })).mount();
	const click = (node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));
	click(container.querySelector(".hole button"));
	await host.settle?.();
	const choices = [...container.querySelectorAll(".choices button")];
	const hbox = choices.find((b) => b.textContent === "➡️ Horizontal box");
	assert.ok(hbox, `no Horizontal box among ${choices.map((b) => b.textContent)}`);
	assert.equal(hbox.title, "Components side by side.");
	assert.deepEqual(host.failures, []);
});

// Pure messages (tutuca's pure: true and apply): a handler that takes no
// context, which a holder applies to a component it holds, synchronously,
// in its own task, through the helper tcd generates; and runtime.apply,
// contractOf and supports from JS. A component with no views renders
// nothing.
test("pure messages are applied to held components, and break their contract with a code", async () => {
	const main = "shelf.tcd";
	const files = {
		[main]: `package tutuca:shelf@0.1.0;
interface Item {
    pure message set_done(done: bool);
    query label() -> string;
    notify picked(text: string);
}
component Card: Item {
    field text: string;
    field done: bool;
    field archived: bool;
    pure message set_done(done: bool) when not archived why "it's archived" ensures next.done == done;
    notify picked(text: string);
    message archive() changes archived emits notify picked;
    query label() -> string;
    view main = p(field(text));
}
component Shelf {
    field items: list<Item>;
    message mark_all() changes items;
    view main = div(render_each(field(items)));
}
component Tally {
    field n: s32;
    pure message add(k: s32) ensures next.n == n + k;
}
component Counted {
    field n: s32;
    pure message set_done(done: bool);
    query label() -> s32;
}
register Card, Shelf, Tally, Counted;
`,
	};
	const wax = `
fn card_on_set_done(state: &card_state, done: i32) -> &card_state {
    card_with_done(state, done);
}
fn card_on_archive(state: &card_state, ctx: &context) -> &card_state {
    card_with_archived(state, 1);
}
fn card_query_label(state: &card_state) -> js_string {
    state.text;
}
fn shelf_on_mark_all(state: &shelf_state, ctx: &context) -> &shelf_state {
    let out = list_empty();
    let i = 0;
    while i <s list_count(state.items) {
        out = list_push(out, item_apply_set_done(list_get(state.items, i)!, 1));
        i += 1;
    }
    shelf_with_items(state, out);
}
fn tally_on_add(state: &tally_state, k: i32) -> &tally_state {
    tally_with_n(state, state.n + k);
}
fn counted_on_set_done(state: &counted_state, done: i32) -> &counted_state {
    state;
}
fn counted_query_label(state: &counted_state) -> i32 {
    state.n;
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "shelf.wax", text: wax }], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const card = rt.make(scope, "Card", { text: "a" });
	const done = rt.apply(card, "set_done", [true]);
	assert.equal(rt.get(done.ok, "done"), true);
	assert.equal(rt.get(card, "done"), false, "applied outside a task, the component itself stays");
	const archived = rt.make(scope, "Card", { text: "b", archived: true });
	assert.deepEqual(rt.apply(archived, "set_done", [true]).err, {
		code: "pre",
		issues: ["pre"],
		detail: "it's archived",
		component: "Card",
		message: "set_done",
	});
	assert.equal(rt.apply(card, "archive").err.code, "not-pure");
	assert.equal(rt.apply(card, "nope").err.code, "unknown");
	assert.equal(rt.apply(card, "set_done", ["yes"]).err.code, "arg:0");
	assert.equal(rt.apply(card, "set_done", []).err.code, "args");
	const contract = rt.contractOf(card);
	assert.deepEqual(
		contract.implements.map(({ name, resolved, interface: it }) => [name, resolved, it.queries.map((q) => [q.name, q.returns.type]), it.notifies.map((n) => n.name)]),
		[["Item", true, [["label", "string"]], ["picked"]]],
	);
	assert.deepEqual(contract.notifies, ["picked"]);
	assert.deepEqual(contract.queries[0].returns.type, "string");
	assert.deepEqual(rt.typeContractOf(scope, "Card"), contract);
	assert.equal(rt.typeContractOf(scope, "Nope"), null);
	assert.deepEqual(
		contract.messages.map((m) => [m.name, m.pure]),
		[
			["set_done", true],
			["archive", false],
		],
	);
	assert.deepEqual(contract.queries.map((q) => q.name), ["label"]);
	assert.deepEqual(rt.supports(card, "Item"), []);
	// Every gap, as tutuca's interfaceGaps lists them.
	assert.deepEqual(rt.supports(rt.make(scope, "Tally", {}), "Item"), ["it has no pure message set_done", "it has no query label"]);
	assert.deepEqual(rt.supports(rt.make(scope, "Counted", {}), "Item"), ["its query label returns s32, Item's returns string"]);
	assert.equal(rt.canApply(card, "set_done"), true);
	assert.equal(rt.canApply(card, "archive"), false);
	assert.equal(rt.canQuery(card, "label"), true);
	// In a task: the shelf applies set_done to each card, in its own task.
	const { window } = new JSDOM("");
	const shelfOf = (items) => rt.make(scope, "Shelf", { items });
	const container = window.document.createElement("div");
	const host = rt.createHost(window.document, container, shelfOf([card, rt.make(scope, "Card", { text: "c" })]), { dev: true }).mount();
	// From outside, a pure message applied at once to a component in the
	// tree (tutuca's host.apply), and a query and an address there.
	const records = [];
	host.listen((r) => records.push(r));
	host.apply("set_done", [true], { to: [["items", 1]] });
	assert.equal(rt.get(rt.get(host.root(), "items")[1], "done"), true);
	assert.throws(() => host.apply("archive", [], { to: [["items", 1]] }), (e) => e.code === "not-pure");
	assert.throws(() => host.apply("set_done", [true], { to: [["items", 9]] }), (e) => e.code === "not-component");
	assert.deepEqual(host.query("label", [], { to: [["items", 1]] }), { ok: "c" });
	assert.equal(host.query("label", [], { to: [["items", 9]] }).err.code, "not-component");
	assert.deepEqual(host.addressOf([["items", 1]]).path, ["items", 1]);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(
		records.filter((r) => r.kind === "transition").map((r) => [r.mode, r.name, r.outcome]),
		[
			["apply", "set_done", "handled"],
			["apply", "archive", "failed"],
			["apply", "set_done", "failed"],
		],
	);
	host.send("mark_all", [], { now: true });
	assert.deepEqual(
		rt.get(host.root(), "items").map((c) => rt.get(c, "done")),
		[true, true],
	);
	assert.deepEqual(host.failures, []);
	assert.deepEqual(host.issues, []);
	// A broken contract fails the task, saying why.
	const other = rt.createHost(window.document, window.document.createElement("div"), shelfOf([card, archived])).mount();
	other.send("mark_all", [], { now: true });
	assert.match(other.failures[0].message, /Card can't apply set_done: pre \(it's archived\)/);
	assert.deepEqual(
		rt.get(other.root(), "items").map((c) => rt.get(c, "done")),
		[false, false],
		"the failed task changed nothing",
	);
	// A component with no views handles messages and renders nothing.
	const tally = rt.make(scope, "Tally", {});
	assert.equal(rt.get(rt.apply(tally, "add", [3]).ok, "n"), 3);
	const quiet = window.document.createElement("div");
	rt.createHost(window.document, quiet, tally).mount();
	assert.equal(quiet.textContent, "");
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
    let _ = gauge_ask_count(ctx);
    gauge_with_ok(state, 0);
}

fn gauge_reply_count_ok(state: &gauge_state, ctx: &context, reply: i32) -> &gauge_state {
    state;
}

// Not the s32 it's declared to reply with: the reply is rejected.
fn gauge_answer_count(ctx: &context) -> &value {
    value_ok(value_string(gt_x));
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "gauge.wax", text: wax }], runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Gauge", {}), { dev: true });
	host.send("spoil", [], { now: true });
	assert.deepEqual(host.failures.map((e) => e.rejection?.message), ["count.ok"]);
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
    let _ = oracle_ask_good(ctx);
    state;
}

fn oracle_on_ask_bad(state: &oracle_state, ctx: &context) -> &oracle_state {
    let _ = oracle_ask_bad(ctx);
    state;
}

fn oracle_reply_good_ok(state: &oracle_state, ctx: &context, reply: i32) -> &oracle_state {
    oracle_with_got(state, reply);
}

fn oracle_reply_bad_ok(state: &oracle_state, ctx: &context, reply: i32) -> &oracle_state {
    oracle_with_got(state, reply);
}

fn oracle_answer_good(ctx: &context) -> &value {
    ctx_log(ctx, value_string(gt_x));
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
	host.send("ask_good", [], { now: true });
	host.send("ask_bad", [], { now: true });
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
	const runtimeMods = [...imports.matchAll(/#\[import = "([a-z]+)"\]\s*const s_mod_\w+: js_string;/g)].map((m) => m[1]).sort();
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

// What a model writes in Wax when it writes another language's, each with
// the diagnostic it gets and the hint tcd adds (compose/hints.mbt), which
// says what to write instead: the studio's assistant reads them.
test("Wax's diagnostics for another language's habits come with a hint saying what to write", async () => {
	const main = "score.tcd";
	const files = {
		[main]: `package tutuca:score@0.1.0;
component Score {
    field ours: s32;
    field theirs: s32;
    get left: s32;
    view main = p(field(left));
}
`,
	};
	const get = (body) => `fn score_get_left(state: &score_state) -> i32 {\n    ${body}\n}\n`;
	const cases = [
		["an i32 compared with >=", get("if state.ours >= 30 { return 0; }\n    30 - state.ours;"), /'i32' and 'number'/, /compare with <s <=s >s >=s/],
		["an i32 divided with /", get("state.ours / 2;"), /'i32' and 'number'/, /divide with \/s/],
		["%", get("state.ours % 2;"), /Unexpected character '%'/, /%s/],
		["&&", get("if (state.ours == 1) && (state.theirs == 2) { return 1; }\n    0;"), /Expecting an expression/, /& and \|/],
		["||", get("if (state.ours == 1) || (state.theirs == 2) { return 1; }\n    0;"), /Expecting an expression/, /& and \|/],
		["else if", get("if state.ours == 1 { return 1; } else if state.ours == 2 { return 2; }\n    0;"), /Expecting a block/, /no else if/],
		["true", get("true;"), /'true' is not bound/, /1 for true/],
		["max", get("max(state.ours, state.theirs);"), /'max' is not bound/, /did you mean int_max/],
		["a typo", get("int_txt(state.ours);\n    0;"), /'int_txt' is not bound/, /did you mean int_text\?/],
		["a gs_ the .tcd doesn't have", get("js_string_length(gs_nothing);"), /'gs_nothing' is not bound/, /declare a string of your own/],
		["as i32", get("let x = 1.5;\n    x as i32;"), /cannot be cast/, /x as i32_s/],
		["an f64 where an i32 goes", get("state.ours as f64_s * 1.5;"), /'f64' but is expected to have type 'i32'/, /as i32_s/],
		["&local", get("let n = state.ours;\n    &n;"), /expecting '}'/, /no address-of/],
	];
	for (const [what, wax, message, hint] of cases) {
		const res = tcd.build({ main, files, impls: [{ path: "score.wax", text: wax }], runtime });
		const errors = res.diags.filter((d) => d.severity === "error");
		assert.equal(res.ok, false, what);
		assert.ok(
			errors.some((d) => message.test(d.message) && hint.test(d.hint ?? "")),
			`${what}: ${errors.map((d) => `${d.message} (${d.hint})`).join("; ")}`,
		);
	}
	// Two i32s compared with >: Wax (0.4.2 on) says so at the operator.
	const res = tcd.build({ main, files, impls: [{ path: "score.wax", text: get("if state.ours > state.theirs { return 1; }\n    0;") }], runtime });
	const errors = res.diags.filter((d) => d.severity === "error");
	assert.deepEqual(
		errors.map((d) => [d.code, d.message, d.span.file, d.span.start.line, d.span.start.col, /<s <=s >s >=s/.test(d.hint ?? "")]),
		[["wax", "This operator cannot be applied to operands of types 'i32' and 'i32'.", "score.wax", 2, 19, true]],
	);
});

// The score example's arithmetic, run: tallies of 5 (/s and %s), the leader,
// a percent rounded up through f64, and points kept within the target.
test("the score example tallies, rounds and keeps points within the target", async () => {
	const path = "studio/assistant/examples/score";
	const res = tcd.build({ main: "score.tcd", files: { "score.tcd": await read(`${path}.tcd`) }, impls: [{ path: "score.wax", text: await read(`${path}.wax`) }], runtime });
	assert.equal(res.ok, true);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const score = tw.runtime.make(scope, "Score", { ours: 13, theirs: 7 });
	const get = (name) => tw.runtime.get(score, name);
	assert.equal(get("ours_tally"), "▣▣ +3");
	assert.equal(get("theirs_tally"), "▣ +2");
	assert.equal(get("status"), "Us leads by 6");
	assert.equal(get("left"), 17);
	assert.equal(get("percent"), 44);
	assert.equal(get("over"), false);
	const won = tw.runtime.make(scope, "Score", { ours: 30, theirs: 30, target: 30 });
	assert.equal(tw.runtime.get(won, "status"), "Tied");
	assert.equal(tw.runtime.get(tw.runtime.make(scope, "Score", { ours: 30, theirs: 2 }), "status"), "Us won");
});

test("a query takes arguments: the runtime checks them against its schema, then runs it", async () => {
	const QTCD = "q/q.tcd";
	const QWAX = "q/q.wax";
	const tcdText = `package tutuca:q@0.1.0;

component Lookup {
    field words: list<string>;
    /// The word at i, or "" past the end.
    query nth(i: s32 where i >= 0) -> string;
    query plus(a: s32, b: s32) -> s32;
    /// What the page's shout function makes of text.
    query shout(text: string) -> any;
    get count: s32;
    view main = p(field(count));
}
`;
	const waxText = `import "'" {
    #[import = ""]
    const s_empty: js_string;
}

fn lookup_get_count(state: &lookup_state) -> i32 {
    list_count(state.words);
}

fn lookup_query_nth(state: &lookup_state, i: i32) -> js_string {
    let got = list_get(state.words, i);
    if !got {
        return s_empty;
    }
    let s = value_string_of(got!);
    if !s {
        return s_empty;
    }
    s!;
}

fn lookup_query_plus(state: &lookup_state, a: i32, b: i32) -> i32 {
    a + b;
}

fn lookup_query_shout(state: &lookup_state, text: js_string) -> &value {
    host_call(gs_shout, list_push(list_empty(), value_string(text)));
}
`;
	const res = tcd.build({ main: QTCD, files: { [QTCD]: tcdText }, impls: [{ path: QWAX, text: waxText }], runtime });
	assert.deepEqual(
		res.diags.filter((d) => d.severity === "error"),
		[],
	);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const c = tw.runtime.make(scope, "Lookup", { words: ["a", "b"] });
	tw.runtime.defineHostFn("shout", (text) => {
		if (text === "") throw new Error("nothing to shout");
		return { loud: text.toUpperCase() };
	});
	assert.deepEqual(tw.runtime.query(c, "shout", ["hi"]), { ok: { ok: { loud: "HI" } } });
	assert.deepEqual(tw.runtime.query(c, "shout", [""]), { ok: { err: "nothing to shout" } });
	assert.deepEqual(tw.runtime.query(c, "nth", [1]), { ok: "b" });
	assert.deepEqual(tw.runtime.query(c, "nth", [5]), { ok: "" });
	assert.deepEqual(tw.runtime.query(c, "plus", [2, 3]), { ok: 5 });
	assert.equal(tw.runtime.query(c, "nth", [-1]).err.code, "arg:0");
	assert.match(tw.runtime.query(c, "nth", []).err.detail, /argument/);
	assert.equal(tw.runtime.query(c, "nth", []).err.code, "args");
	assert.deepEqual(tw.runtime.query(c, "nope", []).err, { code: "unknown", issues: ["unknown"], detail: "no such query", component: "Lookup", message: "nope" });
	const schema = tw.runtime.schema(c);
	assert.deepEqual(
		schema.queries.map((q) => [q.name, q.args.map((a) => a.name)]),
		[
			["nth", ["i"]],
			["plus", ["a", "b"]],
			["shout", ["text"]],
		],
	);
});

// What a task carries, as in tutuca's tree: its sender, so a handler replies
// to it (to the component that notified, from any hop; to the host, it's
// unhandled); a message for a place no component is at is dropped as
// orphaned; send without now waits for the next tick, with now it has run
// when send returns, as an event has.
test("tasks carry their sender: reply, orphaned, send now or later, events now", async () => {
	const main = "envelope.tcd";
	const files = {
		[main]: `package tutuca:envelope@0.1.0;
component Child {
    field pongs: s32;
    notify pinged();
    message ping() changes nothing emits notify pinged;
    message pong() changes pongs;
    view main = button(class: "ping", on_click: send(ping), field(pongs));
}
component Parent {
    field child: Child;
    field text: string;
    message pinged() changes nothing emits reply pong;
    message echo() changes nothing emits reply echoed;
    message set_text(text: string) changes text;
    view main = div(render(field(child)), input(class: "text", value: field(text), on_input: send(set_text, target_value())));
}
register Child, Parent;
`,
	};
	const wax = `fn child_on_ping(state: &child_state, ctx: &context) -> &child_state {
    child_notify_pinged(ctx);
    state;
}
fn child_on_pong(state: &child_state, ctx: &context) -> &child_state {
    child_with_pongs(state, state.pongs + 1);
}
fn parent_on_pinged(state: &parent_state, ctx: &context) -> &parent_state {
    ctx_reply(ctx, gs_pong, [value_array|null; 0]);
    state;
}
fn parent_on_echo(state: &parent_state, ctx: &context) -> &parent_state {
    ctx_reply(ctx, gs_echoed, [value_array|null; 0]);
    state;
}
fn parent_on_set_text(state: &parent_state, ctx: &context, text: js_string) -> &parent_state {
    parent_with_text(state, text);
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "envelope.wax", text: wax }], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const records = [];
	const publish = (r) => records.push(r);
	const host = rt.createHost(window.document, container, rt.make(scope, "Parent", { child: rt.make(scope, "Child", {}), text: "" }), { dev: true, publish }).mount();
	const pongs = () => rt.get(rt.get(host.root(), "child"), "pongs");
	// The child notifies, the parent replies, the reply reaches the child.
	container.querySelector(".ping").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.equal(pongs(), 1);
	// What host.listen hears, as tutuca's: a Transition per task, in a chain
	// (cause, origin) from the host, and the host's events around them.
	const transitions = records.filter((r) => r.kind === "transition");
	assert.deepEqual(
		transitions.map(({ seq, cause, origin, mode, name, outcome, from, to }) => [seq, cause, origin, mode, name, outcome, from?.path ?? null, to.path]),
		[
			[1, null, 1, "send", "ping", "handled", null, ["child"]],
			[2, 1, 1, "notify", "pinged", "handled", ["child"], []],
			[3, 2, 1, "send", "pong", "handled", [], ["child"]],
		],
	);
	assert.deepEqual(transitions[0].emitted, [{ kind: "notify", name: "pinged", args: [] }]);
	assert.deepEqual(transitions[1].emitted, [{ kind: "reply", name: "pong", args: [] }]);
	assert.deepEqual(
		records.filter((r) => r.kind === "hostEvent").map((r) => [r.type, r.upTo ?? null]),
		[
			["started", null],
			["rendered", null],
			["settled", null],
			["rendered", 3],
			["settled", 3],
		],
	);
	assert.deepEqual(records.map((r) => r.n), records.map((_, i) => i + 1));
	records.length = 0;
	// From the host, a reply is unhandled: the host has no handlers.
	host.send("echo", [], { now: true });
	assert.deepEqual(host.unhandled, ["echoed"]);
	// Later: queued until the next tick.
	const seq = host.send("ping", [], { to: ["child"] });
	assert.equal(typeof seq, "number");
	assert.equal(pongs(), 1);
	await host.settled();
	assert.equal(pongs(), 2);
	// Nobody at the place it's sent to: orphaned.
	host.send("ping", [], { to: ["text"], now: true });
	assert.deepEqual(host.reports.filter((r) => r.type === "orphaned").map((r) => r.message), ["ping"]);
	assert.deepEqual(
		records.filter((r) => r.kind === "transition").map((r) => [r.name, r.outcome, r.unhandled]),
		[
			["echo", "handled", ["echoed"]],
			["ping", "handled", []],
			["pinged", "handled", []],
			["pong", "handled", []],
			["ping", "orphaned", []],
		],
	);
	// An event runs now, and so does what waited for the next tick: a run
	// takes the whole queue, the event first.
	const input = container.querySelector(".text");
	host.send("ping", [], { to: ["child"] });
	input.value = "a";
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
	assert.equal(rt.get(host.root(), "text"), "a");
	assert.equal(pongs(), 3);
	assert.deepEqual(host.failures, []);
	assert.deepEqual(host.issues, []);
	// Stopped, it says so and runs nothing more.
	host.send("ping", [], { to: ["child"] });
	host.unmount();
	await host.settled();
	assert.equal(pongs(), 3);
	assert.equal(records.at(-1).type, "stopped");
});

// Watches, as tutuca's sendAt with { settled, progress, timeout }: what a
// message causes is counted, and once none of it is left the watcher gets
// settled with a report; progress tells it along the way; a cancel drops
// what's queued and aborts the asks it waits for; a timeout cancels it.
test("a watch settles once what a message caused ran, and can be cancelled or time out", async () => {
	const main = "watched.tcd";
	const files = {
		[main]: `package tutuca:watched@0.1.0;
component Worker {
    field steps: s32;
    ask slow() -> s32;
    message work();
    message slow_work();
    message step() changes steps;
    view main = p(field(steps));
}
component Boss {
    field worker: Worker;
    field watch: s32;
    field outcome: string;
    field tasks: s32;
    field seen: s32;
    message start(timeout: f64);
    message start_slow(timeout: f64);
    message stop();
    message done(report: any) changes outcome, tasks;
    message progressed(report: any) changes seen;
    view main = div(render(field(worker)));
}
register Worker, Boss;
host_ask slow;
`,
	};
	const wax = `fn here() -> &selector {
    {selector| steps: [selector_step_array|null; 0] };
}
fn none() -> &value_array {
    [value_array|null; 0];
}
fn worker_on_work(state: &worker_state, ctx: &context) -> &worker_state {
    ctx_send_at(ctx, gs_step, none(), here());
    ctx_send_at(ctx, gs_step, none(), here());
    state;
}
fn worker_on_slow_work(state: &worker_state, ctx: &context) -> &worker_state {
    let _ = worker_ask_slow(ctx);
    state;
}
fn worker_on_step(state: &worker_state, ctx: &context) -> &worker_state {
    worker_with_steps(state, state.steps + 1);
}
fn worker_reply_slow_ok(state: &worker_state, ctx: &context, reply: i32) -> &worker_state {
    worker_with_steps(state, reply);
}
fn boss_watch(state: &boss_state, ctx: &context, name: js_string, timeout: f64) -> &boss_state {
    let id = ctx_send_watched(ctx, name, none(), selector_field(gs_worker), gs_done, none(), gs_progressed, none(), timeout, 0);
    boss_with_watch(state, id);
}
fn boss_on_start(state: &boss_state, ctx: &context, timeout: f64) -> &boss_state {
    boss_watch(state, ctx, gs_work, timeout);
}
fn boss_on_start_slow(state: &boss_state, ctx: &context, timeout: f64) -> &boss_state {
    boss_watch(state, ctx, gs_slow_work, timeout);
}
fn boss_on_stop(state: &boss_state, ctx: &context) -> &boss_state {
    ctx_cancel(ctx, state.watch);
    state;
}
fn boss_on_done(state: &boss_state, ctx: &context, report: &value) -> &boss_state {
    let next = boss_with_outcome(state, value_string_of(map_get(report, gs_outcome)!)!);
    boss_with_tasks(next, (map_get(report, gs_tasks)! as &value_int).value);
}
fn boss_on_progressed(state: &boss_state, ctx: &context, report: &value) -> &boss_state {
    boss_with_seen(state, state.seen + 1);
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "watched.wax", text: wax }], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	let signal = null;
	const slow = function () {
		signal = this.signal;
		return new Promise((resolve) => setTimeout(() => resolve(7), 50));
	};
	const records = [];
	const boss = () => rt.make(scope, "Boss", { worker: rt.make(scope, "Worker", {}), outcome: "", tasks: 0, seen: 0, watch: 0 });
	const get = (h, name) => rt.get(h.root(), name);
	// Settled once work and the two steps it sent ran, progress along the way.
	const host = rt.createHost(null, null, boss(), { dev: true, asks: { slow }, publish: (r) => records.push(r) }).mount();
	host.send("start", [-1], { now: true });
	assert.equal(rt.get(get(host, "worker"), "steps"), 2);
	assert.equal(get(host, "outcome"), "ok");
	assert.equal(get(host, "tasks"), 3);
	assert.ok(get(host, "seen") >= 1);
	assert.deepEqual(
		records.filter((r) => r.type?.startsWith("watch")).map((r) => [r.type, r.watch, r.outcome ?? null]),
		[
			["watchOpened", 1, null],
			["watchSettled", 1, "ok"],
		],
	);
	assert.deepEqual(
		records.filter((r) => r.kind === "transition" && r.watch === 1).map((r) => r.name),
		["work", "step", "step"],
	);
	// Cancelled, its ask's answer is dropped and its signal aborted.
	host.send("start_slow", [-1], { now: true });
	assert.equal(get(host, "outcome"), "ok");
	host.send("stop", [], { now: true });
	assert.equal(get(host, "outcome"), "cancelled");
	assert.equal(signal.aborted, true);
	assert.ok(records.some((r) => r.kind === "transition" && r.outcome === "dropped" && r.name === "slow"));
	await new Promise((resolve) => setTimeout(resolve, 80));
	await host.settled();
	assert.equal(rt.get(get(host, "worker"), "steps"), 2, "the answer of a cancelled ask is ignored");
	// Timed out.
	host.send("start_slow", [10], { now: true });
	await new Promise((resolve) => setTimeout(resolve, 30));
	await host.settled();
	assert.equal(get(host, "outcome"), "timeout");
	assert.deepEqual(host.failures, []);
	assert.deepEqual(host.issues, []);
	host.unmount();
});

// A view runs the component's queries, as tutuca's $query: query(name,
// args...), the arguments literals or value reads of the parameters' types.
test("views run the component's queries", async () => {
	const main = "q.tcd";
	const source = (view) => `package tutuca:q@0.1.0;
component Sum {
    field n: s32;
    query plus(k: s32) -> s32;
    message inc() changes n;
    view main = ${view};
}
register Sum;
`;
	const wax = `fn sum_query_plus(state: &sum_state, k: i32) -> i32 {
    state.n + k;
}
fn sum_on_inc(state: &sum_state, ctx: &context) -> &sum_state {
    sum_with_n(state, state.n + 1);
}
`;
	const codes = (view) => tcd.check({ main, files: { [main]: source(view) } }).diags.map((d) => d.code);
	assert.deepEqual(codes("p(query(nope))"), ["tcd.view.query"]);
	assert.deepEqual(codes("p(query(plus))"), ["tcd.view.arity"]);
	assert.deepEqual(codes('p(query(plus, "x"))'), ["tcd.view.query"]);
	const files = { [main]: source('p(class: "sum", query(plus, field(n)), " ", query(plus, 10))') };
	const res = tcd.build({ main, files, impls: [{ path: "q.wax", text: wax }], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Sum", { n: 2 }), { dev: true }).mount();
	assert.equal(container.querySelector(".sum").textContent, "4 12");
	host.send("inc", [], { now: true });
	assert.equal(container.querySelector(".sum").textContent, "6 13");
	assert.deepEqual(host.failures, []);
});

// The render cache, as tutuca's CopyCache: a component renders again only
// when its instance, its view or a provided value it reads changed, and a
// cached page renders what an uncached one does.
test("the render cache reuses unchanged components and renders what no cache does", async () => {
	const main = "cached.tcd";
	const files = {
		[main]: `package tutuca:cached@0.1.0;
component Cell {
    field n: s32;
    pure message bump() changes n;
    view main = span(class: "cell", field(n), " ", provided(mode));
    view plain = span(class: "cell", field(n));
}
component Grid {
    field mode: string;
    field cells: list<Cell>;
    field plain: Cell;
    provide mode = field(mode);
    message set_mode(mode: string) changes mode;
    message bump(i: s32);
    message add();
    view main = div(render_each(field(cells)), render(view: plain, field(plain)));
}
register Cell, Grid;
`,
	};
	const wax = `fn cell_on_bump(state: &cell_state) -> &cell_state {
    cell_with_n(state, state.n + 1);
}
fn grid_on_set_mode(state: &grid_state, ctx: &context, mode: js_string) -> &grid_state {
    grid_with_mode(state, mode);
}
fn grid_on_bump(state: &grid_state, ctx: &context, i: i32) -> &grid_state {
    grid_with_cells(state, list_assoc(state.cells, i, cell_apply_bump(list_get(state.cells, i)!)));
}
fn grid_on_add(state: &grid_state, ctx: &context) -> &grid_state {
    grid_with_cells(state, list_push(state.cells, value_component(ctx_make(ctx, gs_Cell, map_empty()))));
}
`;
	const res = tcd.build({ main, files, impls: [{ path: "cached.wax", text: wax }], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const grid = () => rt.make(scope, "Grid", { mode: "a", cells: [0, 1, 2].map((n) => rt.make(scope, "Cell", { n })), plain: rt.make(scope, "Cell", { n: 9 }) });
	const mounted = (renderCache) => {
		const container = window.document.createElement("div");
		const host = rt.createHost(window.document, container, grid(), { dev: true, renderCache }).mount();
		return { host, container };
	};
	const cached = mounted(true);
	const uncached = mounted(false);
	const steps = [
		["bump", [1]],
		["set_mode", ["b"]],
		["add", []],
		["bump", [3]],
		["set_mode", ["b"]],
		["bump", [0]],
	];
	let last = cached.host.cacheStats();
	const misses = [];
	for (const [name, args] of steps) {
		cached.host.send(name, args, { now: true });
		uncached.host.send(name, args, { now: true });
		assert.equal(cached.container.innerHTML, uncached.container.innerHTML, `after ${name}`);
		const now = cached.host.cacheStats();
		misses.push(now.misses - last.misses);
		last = now;
	}
	// Bumping a cell renders the grid and that cell; the mode, every cell
	// that reads it but not the plain one, which doesn't; the same mode, the
	// grid alone (its with_ makes a new instance, but what the cells read is
	// as it was); adding, the grid and the new cell.
	assert.deepEqual(misses, [2, 4, 2, 2, 1, 2]);
	assert.deepEqual(uncached.host.cacheStats(), { hits: 0, misses: 0 });
	assert.deepEqual(cached.host.failures, []);
});

// A made default that can't be made says each field on the way, as
// tutuca's prefixed does; a component provides an item of a list field at
// the key another field holds, as tutuca's provides take any selector.
test("nested defaults say where they failed, and a provide is a field or an item of one", async () => {
	const main = "nest.tcd";
	const files = {
		[main]: `package tutuca:nest@0.1.0;
component Leaf { field id: s32; view main = p("leaf"); }
component Mid { field leaf: Leaf = make(Leaf); view main = p("mid"); }
component Outer { field mid: Mid = make(Mid); view main = p("outer"); }
component Reader { field n: s32; view main = span(class: "picked", provided(picked)); }
component Picker {
    field names: list<string>;
    field current: s32;
    field reader: Reader;
    provide picked = seq_item(names, current);
    view main = div(render(field(reader)));
}
register Mid, Outer, Reader, Picker;
`,
	};
	assert.deepEqual(
		tcd.check({ main, files: { [main]: files[main].replace("seq_item(names, current)", "seq_item(current, names)") } }).diags.map((d) => d.code),
		["tcd.provide.field"],
	);
	const res = tcd.build({ main, files, impls: [], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	// Leaf isn't registered here: Mid's default can't be made, nor Outer's.
	assert.throws(() => rt.make(scope, "Outer", {}), /^Error: Outer\.mid: Mid\.leaf: No component type is registered as Leaf/);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const picker = rt.make(scope, "Picker", { names: ["a", "b"], current: 1, reader: rt.make(scope, "Reader", {}) });
	rt.createHost(window.document, container, picker).mount();
	assert.equal(container.querySelector(".picked").textContent, "b");
});

// A public field is also a query, as tutuca's .public(): what others read it
// by, in the contract, through runtime.query, and what an interface's query
// takes.
test("a public field is a query too, and meets an interface's query", async () => {
	const main = "pub.tcd";
	const files = {
		[main]: `package tutuca:pub@0.1.0;
interface Named { query name() -> string; }
component Tag: Named {
    public field name: string;
    field hidden: s32;
    view main = p(field(name));
}
register Tag;
`,
	};
	const bad = files[main].replace("public field name: string;", "public field name: s32;");
	assert.deepEqual(tcd.check({ main, files: { [main]: bad } }).diags.map((d) => d.code), ["tcd.interface.type"]);
	const res = tcd.build({ main, files, impls: [], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const tag = rt.make(scope, "Tag", { name: "x" });
	assert.deepEqual(rt.query(tag, "name"), { ok: "x" });
	assert.equal(rt.query(tag, "hidden").err.code, "unknown");
	assert.equal(rt.canQuery(tag, "name"), true);
	assert.deepEqual(rt.contractOf(tag).queries.map((q) => [q.name, q.returns.type]), [["name", "string"]]);
	assert.deepEqual(rt.schema(tag).fields.map((f) => [f.name, f.public ?? false]), [
		["name", true],
		["hidden", false],
	]);
	assert.deepEqual(rt.supports(tag, "Named"), []);
});

// A component renders more than a page, by target, as tutuca's renders: its
// views for a target are written in the target's nodes (md's Paragraph,
// Strong), and render to plain data the target's renderer lowers.
test("views for a render target render to its nodes, as data", async () => {
	const main = "md.tcd";
	const files = {
		[main]: `package tutuca:md@0.1.0;
component Item { field text: string; view main = li(field(text)); view main @target(md) = ListItem(Paragraph(field(text))); }
component Note {
    field title: string;
    field count: s32;
    field items: list<Item>;
    view main = p(field(title));
    view main @target(md) = Root(Heading(depth: 1, field(title)), Paragraph("Count: ", Strong(field(count))), List(render_each(field(items))));
    view brief @target(md) = Paragraph(field(title));
}
component Plain { field n: s32; view main = p(field(n)); }
register Item, Note, Plain;
`,
	};
	const noMain = files[main].replace("view main @target(md) = Root(", "view other @target(md) = Root(");
	assert.ok(tcd.check({ main, files: { [main]: noMain } }).diags.some((d) => d.code === "tcd.view.main"));
	const res = tcd.build({ main, files, impls: [], runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const note = rt.make(scope, "Note", { title: "T", count: 2, items: [rt.make(scope, "Item", { text: "a" })] });
	const el = (tag, attrs, ...children) => ({ tag, attrs, children });
	assert.deepEqual(rt.renderTarget(note, "md"), [
		el(
			"Root",
			{},
			el("Heading", { depth: 1 }, "T"),
			el("Paragraph", {}, "Count: ", el("Strong", {}, "2")),
			el("List", {}, el("ListItem", {}, el("Paragraph", {}, "a"))),
		),
	]);
	assert.deepEqual(rt.renderTarget(note, "md", { view: "brief" }), [el("Paragraph", {}, "T")]);
	// One without views for the target fails, unless the target falls back
	// to the page's views.
	const plain = rt.make(scope, "Plain", { n: 1 });
	assert.throws(() => rt.renderTarget(plain, "md"), /Component Plain has no md render/);
	assert.deepEqual(rt.renderTarget(plain, "tui", { fallsBackToViews: true }), [el("p", {}, "1")]);
});
