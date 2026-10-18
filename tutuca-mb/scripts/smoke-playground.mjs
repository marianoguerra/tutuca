// The playground, headless: moonc-web.cjs compiles each example in node exactly as the
// browser's worker does (examples/playground/compile.js), and the page (playground.js) runs in
// jsdom with an in-memory editor, importing each linked run as a module. Checks the
// diagnostics parser, that every example compiles and its stories pass their sequences in the
// storybook UI, that the mistakes example reports the compiler's errors and then its check()
// issues, and the page's runs: keys per run, keeping the story, failed compiles and runs.
// Also compiles a few examples to wasm-gc and runs them in the same UI through the wasm-gc
// shell (wasm/loader.mjs).
// Usage: node scripts/smoke-playground.mjs   (after scripts/playground-payload.mjs and
// scripts/vendor-moonc.mjs; needs the parent repo's npm install for jsdom and margaui). Node's
// default stack is enough: the vendored moonc appends lists in a loop (vendor-moonc.mjs).
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "../../node_modules/jsdom/lib/api.js";
import { asPackages, compileRun, loadPayload } from "../examples/playground/compile.js";
import { groupDiagnostics, parseDiagnostic, spanOf } from "../examples/playground/diagnostics.js";
import { definePlayground } from "../examples/playground/embed.js";
import { examples } from "../examples/playground/examples.js";
import { compiles, fileKey, packagesOf } from "../examples/playground/library.js";
import { mountPlayground } from "../examples/playground/playground.js";

const byId = (id) => examples.find((e) => e.id === id);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYGROUND = join(ROOT, "examples/playground");
const OUT = join(ROOT, "_build/playground-smoke");
mkdirSync(OUT, { recursive: true });
let failures = 0;
const test = async (name, f) => {
	try {
		await f();
		console.log(`ok   ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL ${name}\n${error?.stack ?? error}`);
	}
};

// --- the diagnostics parser -----------------------------------------------------------------

await test("parseDiagnostic reads moonc's positions, code, severity and message", () => {
	assert.deepEqual(
		parseDiagnostic("./typos.mbt:10:39-10:45 [E4091] The type Greeting has no field nmae.\n"),
		{
			file: "typos.mbt",
			line: 10,
			col: 39,
			endLine: 10,
			endCol: 45,
			code: "E4091",
			severity: "error",
			message: "The type Greeting has no field nmae.",
		},
	);
	const warning = parseDiagnostic(
		"./counter.mbt:45:27-45:28 [E0002] Warning (unused_value): Unused variable 'x'\n",
	);
	assert.equal(warning.severity, "warning");
	assert.equal(warning.message, "(unused_value): Unused variable 'x'");
	const multi = parseDiagnostic(
		"./a.mbt:1:2-1:3 [E4014] Expr Type Mismatch\n        has type : Int\n        wanted   : String\n",
	);
	assert.equal(multi.message, "Expr Type Mismatch\nhas type : Int\nwanted   : String");
	assert.equal(parseDiagnostic("error: something without a position"), null);
});

await test("groupDiagnostics keeps each file's and the rest", () => {
	const { byFile, other } = groupDiagnostics(
		["./a.mbt:1:1-1:2 [E1] x", "./_boot.mbt:2:3-2:4 [E2] y", "no position"],
		["a.mbt", "b.mbt"],
	);
	assert.equal(byFile.get("a.mbt").length, 1);
	assert.deepEqual(byFile.get("b.mbt"), []);
	assert.equal(other.length, 2);
});

await test("spanOf turns 1-based, end-exclusive columns into offsets, never empty", () => {
	const code = "ab\ncdef\n";
	assert.deepEqual(spanOf(code, { line: 2, col: 2, endLine: 2, endCol: 4 }), { from: 4, to: 6 });
	assert.deepEqual(spanOf(code, { line: 1, col: 3, endLine: 1, endCol: 3 }), { from: 2, to: 3 });
	assert.deepEqual(spanOf(code, { line: 9, col: 1, endLine: 9, endCol: 1 }).from, 8);
});

// --- component libraries as one package ---------------------------------------------------

await test("packagesOf gives each package its name, its aliases' packages and its files by key", () => {
	const packages = packagesOf(byId("json-schema"), (path) => `// ${path}`);
	assert.deepEqual(
		packages.map((p) => p.name),
		["json_editor", "common", "jsonschema", "jsonschema/stories"].map((d) => `marianoguerra/tutuca/examples/${d}`),
	);
	assert.deepEqual(packages[2].uses, {
		jv: "marianoguerra/tutuca/examples/json_editor",
		common: "marianoguerra/tutuca/examples/common",
	});
	assert.deepEqual(packages[0].files, [["json_editor/json.mbt", "// ../json_editor/json.mbt"]]);
	assert.deepEqual(packagesOf(byId("math"), () => "")[0].std, { fm: "math" });
	assert.equal(fileKey(byId("counter"), "../site/counter/counter.mbt"), "counter.mbt");
});

await test("compiles leaves out the files of another backend", () => {
	const ok = compiles(byId("thing-tracker"), "js");
	assert.equal(ok("thingtracker/text_js.mbt"), true);
	assert.equal(ok("thingtracker/text_table.mbt"), false);
	assert.equal(compiles(byId("thing-tracker"), "wasm-gc")("thingtracker/text_js.mbt"), false);
	assert.equal(ok("app.mbt"), true);
});

// A moon.pkg's (non-test) imports of `prefix` packages: { alias: path after the prefix }.
const importsOf = (dir, prefix) => {
	const pkg = readFileSync(join(PLAYGROUND, dir, "moon.pkg"), "utf8");
	const block = pkg.match(/^import \{([^}]*)\}\s*$/m)?.[1] ?? "";
	const re = new RegExp(`"${prefix.replaceAll("/", "\\/")}([\\w/]+)"(?:\\s+@(\\w+))?`, "g");
	return Object.fromEntries([...block.matchAll(re)].map((m) => [m[2] ?? m[1].split("/").pop(), m[1]]));
};
// The example packages it imports: { alias: dir relative to examples/playground }.
const exampleImports = (dir) =>
	Object.fromEntries(
		Object.entries(importsOf(dir, "marianoguerra/tutuca/examples/")).map(([alias, path]) => [alias, `../${path}`]),
	);
// The core-library packages it aliases otherwise than by their last segment.
const stdAliases = (dir) =>
	Object.fromEntries(
		Object.entries(importsOf(dir, "moonbitlang/core/")).filter(([alias, path]) => alias !== path.split("/").pop()),
	);

await test("each library lists its packages' files, every one but the tests, and the aliases of every package they import", () => {
	for (const example of examples.filter((e) => e.packages)) {
		const listed = example.files.toSorted();
		const onDisk = example.packages
			.flatMap(({ dir }) =>
				readdirSync(join(PLAYGROUND, dir))
					.filter((n) => n.endsWith(".mbt") && !/_test\.mbt$|_wbtest\.mbt$/.test(n))
					.map((n) => `${dir}/${n}`),
			)
			.toSorted();
		assert.deepEqual(listed, onDisk, example.id);
		example.packages.forEach((p, i) => {
			assert.deepEqual(p.uses, exampleImports(p.dir), `${example.id}: ${p.dir}'s uses are its moon.pkg's`);
			assert.deepEqual(p.std ?? {}, stdAliases(p.dir), `${example.id}: ${p.dir}'s std aliases are its moon.pkg's`);
			const before = example.packages.slice(0, i).map((q) => q.dir);
			for (const dep of Object.values(p.uses)) assert.ok(before.includes(dep), `${example.id}: ${dep} before ${p.dir}`);
		});
	}
});

// --- compiling, as the worker does ----------------------------------------------------------

const nodeRequire = createRequire(import.meta.url);
const mooncSource = readFileSync(join(PLAYGROUND, "deps/moonc-web.cjs"), "utf8");
// moonc prints what it reports with fs.writeSync; the results carry it, so it's muted.
let muted = false;
const fs = nodeRequire("node:fs");
const quietFs = {
	...fs,
	writeSync: (fd, ...rest) => (muted && (fd === 1 || fd === 2) ? 0 : fs.writeSync(fd, ...rest)),
};
const require = (name) => (name === "fs" || name === "node:fs" ? quietFs : nodeRequire(name));
// A fresh moonc: a failed or wasm-gc compile leaves an instance unusable, as in the worker.
// Each instance adds process listeners (uncaughtException, …); the old one's go with it.
let listeners = [];
const freshMoonc = () => {
	for (const [event, f] of listeners) process.off(event, f);
	const before = new Map(process.eventNames().map((e) => [e, process.listeners(e)]));
	const module = { exports: {} };
	new Function("module", "exports", "require", mooncSource)(module, module.exports, require);
	listeners = process
		.eventNames()
		.flatMap((e) => process.listeners(e).filter((f) => !(before.get(e) ?? []).includes(f)).map((f) => [e, f]));
	return module.exports;
};
// Each backend's payload, read once.
const payloads = new Map();
const payloadFor = async (backend) => {
	if (!payloads.has(backend)) {
		const dir = join(PLAYGROUND, "payload", backend);
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
		payloads.set(backend, await loadPayload(manifest, async (path) => new Uint8Array(readFileSync(join(dir, path)))));
	}
	return payloads.get(backend);
};
const compiler = (() => {
	let moonc = freshMoonc();
	let dirty = false;
	let seen = [];
	return {
		compiles: 0,
		async compile(files, { books, backend = "js" } = {}) {
			const payload = await payloadFor(backend);
			if (dirty) {
				moonc = freshMoonc();
				seen = [];
			}
			this.compiles += 1;
			const t0 = Date.now();
			const r = compileRun(moonc, payload, files, { seen, books });
			seen = r.seen;
			dirty = !r.reusable;
			return { ...r, ms: Date.now() - t0 };
		},
	};
})();
const quiet = async (f) => {
	muted = true;
	try {
		return await f();
	} finally {
		muted = false;
	}
};
const sourcesOf = (example) =>
	example.files.map((path) => {
		const url = new URL(path, pathToFileURL(join(PLAYGROUND, "examples.js")));
		return [url.pathname.split("/").pop(), readFileSync(url, "utf8")];
	});

await test("packages compile on their own: the same names and file names in two, errors by package", async () => {
	const lib = (extra = "") => `pub fn helper() -> Int { 1 }\nfn row() -> Int { helper() }\n${extra}`;
	const user = [
		"pub fn helper() -> Int { @a.helper() + row() }",
		"fn row() -> Int { 2 }",
		"pub fn[N : @vdom.DomNode] books() -> Array[@storybook.Book[N]] { ignore(helper()); [] }",
	].join("\n");
	const packages = (aCode) => [
		{ name: "playground/a", files: [["a/lib.mbt", aCode]] },
		{ name: "playground/b", uses: { a: "playground/a" }, files: [["b/lib.mbt", user]] },
	];
	const ok = await quiet(() => compiler.compile(packages(lib())));
	assert.equal(ok.ok, true, ok.diagnostics.join("\n"));
	const bad = await quiet(() => compiler.compile(packages(lib("fn broken() -> Int { nope }"))));
	assert.equal(bad.ok, false);
	const [d] = bad.diagnostics.map(parseDiagnostic).filter((x) => x?.severity === "error");
	assert.equal(d.file, "a/lib.mbt");
	assert.deepEqual(groupDiagnostics(bad.diagnostics, ["a/lib.mbt", "b/lib.mbt"]).byFile.get("a/lib.mbt").length > 0, true);
});

await test("the compiler reports the three mistakes of typos.mbt", async () => {
	const r = await quiet(() => compiler.compile(sourcesOf(byId("mistakes"))));
	assert.equal(r.ok, false);
	const found = r.diagnostics.map(parseDiagnostic).map((d) => `${d.file}:${d.line} ${d.code}`);
	assert.deepEqual(found, [
		"typos.mbt:10 E4091", // the field is name, not nmae
		"typos.mbt:12 E4014", // Rename sent without its argument
		"typos.mbt:12 E4203",
		"typos.mbt:14 E4031", // there is no Reset message
	]);
});

// --- the page, in jsdom ---------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><div id="playground"></div>', {
	url: pathToFileURL(join(PLAYGROUND, "index.html")).href,
});
const { window } = dom;
Object.assign(globalThis, {
	window,
	document: window.document,
	customElements: window.customElements,
	HTMLElement: window.HTMLElement,
});
const consoleErrors = [];
console.error = (...args) => {
	const text = args.join(" ");
	// jsdom can't parse the CSS margaui compiles.
	if (!text.startsWith("Could not parse CSS stylesheet")) consoleErrors.push(text);
};
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits up to 2 s for f() to hold: a preview's tasks run on a zero timeout, behind whatever
// the page is busy with (margaui compiling CSS).
const until = async (f) => {
	for (let i = 0; i < 100 && !f(); i++) await settle();
};

// An in-memory editor with editor.js's methods.
const createEditor = () => {
	const docs = new Map();
	let current = null;
	return {
		diagnostics: new Map(),
		load(files) {
			docs.clear();
			this.diagnostics.clear();
			for (const [name, code] of files) docs.set(name, code);
			current = files[0]?.[0] ?? null;
		},
		open(name) {
			current = name;
		},
		current: () => current,
		value: (name) => docs.get(name) ?? "",
		set(name, code) {
			docs.set(name, code);
		},
		setDiagnostics(name, list) {
			this.diagnostics.set(name, list);
		},
		clearDiagnostics() {
			this.diagnostics.clear();
		},
	};
};
const changes = [];
const el = window.document.getElementById("playground");
const sizes = new Map(); // example → { ms, kb } of its last compile
const sizeKey = (names, backend = "js") => `${backend}:${names.toSorted().join()}`;
const nodeCompiler = {
	async compile(files, options) {
		const r = await quiet(() => compiler.compile(files, options));
		const bytes = r.js?.length ?? r.wasm?.length;
		const keys = asPackages(files).flatMap((p) => p.files.map((f) => f[0]));
		if (r.ok) sizes.set(sizeKey(keys, options?.backend), { ms: r.ms, kb: Math.round(bytes / 1024) });
		return r;
	},
};
const pageOptions = {
	createEditor,
	base: pathToFileURL(join(PLAYGROUND, "examples.js")).href,
	fetch: async (url) => {
		const text = readFileSync(new URL(url), "utf8");
		return { ok: true, status: 200, text: async () => text };
	},
	// A module of its own per run, under the repo so "margaui" resolves from node_modules.
	importRun: (js, run) => {
		const file = join(OUT, `run-${run}.mjs`);
		writeFileSync(file, js);
		return import(pathToFileURL(file).href);
	},
};
const pg = mountPlayground(el, {
	...pageOptions,
	compiler: nodeCompiler,
	examples,
	onChange: (change) => changes.push(change),
});
const editor = pg.editor;
const app = () => el.querySelector("tutuca-app");
// What the preview shows: its shadow root's last child, after the stylesheets.
const shown = () => app().shadowRoot.lastElementChild.textContent;
const buttons = () => [...el.querySelectorAll("[data-runs] button")];
const button = (text) => buttons().find((b) => b.textContent.trim().startsWith(text));
const alertText = () => el.querySelector('[role="alert"]').textContent;
// What the storybook shows as problems or errors of the selected story.
const problemsShown = () =>
	[...el.querySelectorAll("[data-runs] .text-error")].map((n) => n.textContent.trim()).filter(Boolean);
// Each step's badge, in the storybook's Steps list.
const stepStatuses = () =>
	[...el.querySelectorAll("[data-runs] li > span.badge:first-child")].map((b) => b.textContent.trim());
const toEnd = () => el.querySelector('[data-runs] [title="Run to end"]').click();
const change = (node, value) => {
	node.value = value;
	node.dispatchEvent(new window.Event("change", { bubbles: true }));
};

await test("a run shows its first story live, keyed by the run", async () => {
	await pg.load("counter");
	await settle();
	assert.equal(pg.state.status, "ready", pg.state.error);
	assert.equal(app().getAttribute("app-key"), "p1r1/Counter/From zero@0");
	assert.equal(shown(), "−0+");
	[...app().shadowRoot.querySelectorAll("button")].find((x) => x.textContent === "+").click();
	await until(() => shown() === "−1+");
	assert.equal(shown(), "−1+", "a click in the preview is the story's");
	assert.equal(pg.story(), "Counter/From zero");
	assert.deepEqual(changes.at(-1), { example: "counter", story: "Counter/From zero" });
});

// Every story of the run shown starts valid and passes each of its sequences in the UI.
const storiesPass = async () => {
		assert.equal(pg.state.status, "ready", pg.state.error);
		const stories = buttons().filter((b) => b.className.includes("justify-start font-normal"));
		assert.ok(stories.length > 0, "the sidebar lists the stories");
		for (const name of stories.map((b) => b.textContent.trim())) {
			button(name).click();
			await settle();
			assert.ok(shown().length > 0, `${name} renders`);
			assert.deepEqual(problemsShown(), [], `${name} starts valid`);
			const sequences = el.querySelector('[aria-label="Sequence"]');
			// Every sequence, not "(no sequence)".
			for (const seq of sequences ? [...sequences.options].map((o) => o.value).filter(Boolean) : []) {
				change(el.querySelector('[aria-label="Sequence"]'), seq);
				await settle();
				toEnd();
				await settle();
				const statuses = stepStatuses();
				assert.ok(statuses.length > 0, `${name} › ${seq} has steps`);
				assert.deepEqual(
					statuses.filter((s) => s !== "ok"),
					[],
					`${name} › ${seq}: ${el.querySelector("[data-runs]").textContent}`,
				);
			}
		}
};

// Every story of every example (but the mistakes) passes each of its sequences in the UI.
for (const example of examples.filter((e) => e.id !== "mistakes")) {
	await test(`${example.id}: its stories start valid and pass their sequences in the UI`, async () => {
		await pg.load(example.id);
		await settle();
		await storiesPass();
	});
}

await test("json-schema: the JSON editor is editable, and an edit to it shows in the JSON Schema stories", async () => {
	await pg.load("json-schema", { run: false });
	// The tabs: the stories first, then the components, then the packages they use.
	const tabs = [...el.querySelectorAll('.pg-files [role="tab"]')].map((t) => t.textContent);
	assert.equal(tabs[0], "jsonschema/stories/stories.mbt");
	assert.deepEqual(tabs.slice(-3), ["common/clock.mbt", "common/files.mbt", "json_editor/json.mbt"]);
	assert.ok(tabs.indexOf("jsonschema/views.mbt") < tabs.indexOf("json_editor/json.mbt"), tabs.join());
	const studio = async (text) => {
		for (const story of buttons().filter((b) => b.className.includes("justify-start font-normal"))) {
			story.click();
			await settle();
			if (shown().includes(text)) return story.textContent.trim();
		}
		return null;
	};
	await pg.run();
	await settle();
	assert.equal(pg.state.status, "ready", pg.state.error);
	const before = await studio("JSON text");
	assert.ok(before, "a studio story shows the JSON editor's JSON text toggle");
	assert.equal(await studio("JSON source, edited"), null);
	editor.set("json_editor/json.mbt", editor.value("json_editor/json.mbt").replace('txt("JSON text")', 'txt("JSON source, edited")'));
	await pg.run();
	await settle();
	assert.equal(pg.state.status, "ready", pg.state.error);
	assert.equal(await studio("JSON source, edited"), before);
	assert.match(el.querySelector('[role="tab"][title$="json_editor/json.mbt"]').textContent, /json_editor\/json\.mbt •/);
});

await test("the next run remounts with the story the last one showed", async () => {
	await pg.load("counter");
	await settle();
	button("From ten").click();
	await settle();
	assert.equal(pg.story(), "Counter/From ten");
	editor.set("counter.mbt", editor.value("counter.mbt").replace('txt("+")', 'txt("plus")'));
	const before = pg.state.run;
	await pg.run();
	await settle();
	assert.equal(pg.state.status, "ready", pg.state.error);
	assert.equal(app().getAttribute("app-key"), `p1r${before + 1}/Counter/From ten@0`);
	assert.equal(shown(), "−10plus");
	assert.match(el.querySelector('[role="tab"]').textContent, /counter\.mbt •/);
});

await test("a compile error is underlined in its file and listed; the next good run clears it", async () => {
	const good = editor.value("counter.mbt");
	editor.set("counter.mbt", good.replace("s.count + 1", "s.cuont + 1"));
	await pg.run();
	assert.equal(pg.state.status, "failed");
	assert.match(alertText(), /It doesn't compile: 1 error\./);
	assert.match(alertText(), /no field cuont/);
	const [d] = editor.diagnostics.get("counter.mbt");
	assert.equal(d.severity, "error");
	assert.equal(el.querySelector('[role="tab"]').getAttribute("data-errors"), "1");
	assert.equal(el.querySelector("[data-runs]").hidden, true);
	editor.set("counter.mbt", good);
	await pg.run();
	await settle();
	assert.equal(pg.state.status, "ready", pg.state.error);
	assert.equal(el.querySelector('[role="alert"]').hidden, true);
	assert.equal(el.querySelector('[role="tab"]').getAttribute("data-errors"), null);
});

await test("an error outside the user's files (no books) is listed", async () => {
	const good = editor.value("counter.mbt");
	editor.set("counter.mbt", good.replace("pub fn[N : @vdom.DomNode] books()", "pub fn[N : @vdom.DomNode] stories()"));
	await pg.run();
	assert.equal(pg.state.status, "failed");
	assert.match(alertText(), /_boot\.mbt/);
	editor.set("counter.mbt", good);
});

await test("mistakes: the compiler's errors, then check()'s issues fail the run, then it runs", async () => {
	change(el.querySelector('[aria-label="Example"]'), "mistakes");
	await settle(50);
	while (pg.state.status !== "failed" && pg.state.status !== "ready") await settle(50);
	assert.deepEqual(changes.at(-1), { example: "mistakes" });
	assert.equal(pg.state.status, "failed");
	assert.equal(editor.current(), "typos.mbt", "the file with the errors opens");
	assert.equal(editor.diagnostics.get("typos.mbt").filter((d) => d.severity === "error").length, 4);
	assert.match(alertText(), /It doesn't compile: 4 errors/);
	editor.set("typos.mbt", "");
	await pg.run();
	assert.equal(pg.state.status, "failed");
	assert.match(alertText(), /The run failed: The components have issues/);
	assert.match(alertText(), /`clik` is not a DOM event/);
	assert.match(alertText(), /`class` is set more than once/);
	assert.match(alertText(), /has two `click` handlers/);
	const fixed = editor
		.value("mistakes.mbt")
		.replace('on(Custom("clik"), Rename("Ada"))', 'on_click(Rename("Ada"))')
		.replace(
			/cls\("btn"\),\s*cls\("btn-ghost"\),\s*on_click\(Greet\),\s*on_click\(Rename\("World"\)\),/,
			'cls("btn btn-ghost"), on_click(Rename("World")),',
		);
	editor.set("mistakes.mbt", fixed);
	await pg.run();
	await settle();
	assert.equal(pg.state.status, "ready", pg.state.error);
	toEnd();
	await settle();
	assert.deepEqual(stepStatuses(), ["ok", "ok", "ok"]);
});

await test("a run can ask for a story", async () => {
	await pg.load("async", { story: "Weather/Atlantis" });
	await settle();
	assert.equal(app().getAttribute("app-key"), `${pg.prefix()}Weather/Atlantis@0`);
	// The asks answer in the live preview too.
	app().shadowRoot.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	await settle();
	assert.match(shown(), /No forecast for Atlantis/);
});

await test("a run's previews answer only their own keys", async () => {
	const stale = window.document.createElement("tutuca-app");
	stale.setAttribute("app-key", "p1r1/Weather/Lisbon");
	el.querySelector("[data-runs] > div").append(stale);
	await settle();
	assert.equal(stale.shadowRoot.textContent, "no app for p1r1/Weather/Lisbon");
	stale.remove();
});

// --- wasm-gc ----------------------------------------------------------------------------------

await test("wasm-gc: the counter compiles to wasm, runs live, and keeps its story across runs", async () => {
	await pg.load("counter", { run: false });
	await pg.setBackend("wasm-gc");
	await settle();
	assert.equal(pg.state.status, "ready", pg.state.error);
	assert.match(el.querySelector(".pg-status").textContent, /wasm-gc/);
	assert.match(app().getAttribute("app-key"), new RegExp(`^${pg.prefix()}Counter/From zero@0$`));
	assert.equal(shown(), "−0+");
	[...app().shadowRoot.querySelectorAll("button")].find((x) => x.textContent === "+").click();
	await until(() => shown() === "−1+");
	assert.equal(shown(), "−1+", "a click in the wasm preview counts");
	button("From ten").click();
	await settle();
	assert.equal(pg.story(), "Counter/From ten");
	await pg.run();
	await settle();
	assert.equal(app().getAttribute("app-key"), `${pg.prefix()}Counter/From ten@0`);
	await storiesPass();
});

// A library on its components and the packages they use, and one with a file per backend.
for (const id of ["json-schema", "thing-tracker"]) {
	await test(`wasm-gc: ${id}'s stories start valid and pass their sequences in the UI`, async () => {
		await pg.load(id);
		await settle();
		assert.equal(pg.state.backend, "wasm-gc");
		await storiesPass();
		if (id === "thing-tracker") {
			const off = [...el.querySelectorAll('.pg-files [role="tab"][data-off]')].map((t) => t.textContent);
			assert.deepEqual(off, ["thingtracker/text_js.mbt"]);
		}
	});
}

await test("wasm-gc: a compile error is listed, and check()'s issues fail the run", async () => {
	await pg.load("mistakes");
	assert.equal(pg.state.status, "failed");
	assert.match(alertText(), /It doesn't compile: 4 errors/);
	editor.set("typos.mbt", "");
	await pg.run();
	assert.equal(pg.state.status, "failed");
	assert.match(alertText(), /The run failed: .*The components have issues/s);
	await pg.setBackend("js");
	assert.equal(pg.state.status, "failed");
	assert.match(alertText(), /The run failed: The components have issues/);
});

// --- embedded playgrounds --------------------------------------------------------------------

await test("two embedded playgrounds run independently; a lazy one waits", async () => {
	definePlayground({ window, compiler: () => nodeCompiler, ...pageOptions });
	const section = window.document.createElement("section");
	section.innerHTML = [
		'<tutuca-playground example="counter" eager></tutuca-playground>',
		'<tutuca-playground example="todo-list" eager></tutuca-playground>',
		'<tutuca-playground example="async"></tutuca-playground>',
	].join("");
	window.document.body.append(section);
	const [a, b, lazy] = section.querySelectorAll("tutuca-playground");
	const ready = async (...els) => {
		for (let i = 0; i < 600 && els.some((e) => e.getAttribute("data-status") !== "ready"); i++) await settle(50);
		for (const e of els) assert.equal(e.getAttribute("data-status"), "ready", e.playground.state.error);
	};
	await ready(a, b);
	await settle();
	const appOf = (e) => e.querySelector("tutuca-app");
	const shownIn = (e) => appOf(e).shadowRoot.lastElementChild.textContent;
	const keyA = appOf(a).getAttribute("app-key");
	const keyB = appOf(b).getAttribute("app-key");
	assert.match(keyA, /^p\d+r1\/Counter\/From zero@0$/);
	assert.match(keyB, /^p\d+r1\/Todo list\/Empty@0$/);
	assert.notEqual(keyA.split("/")[0], keyB.split("/")[0]);
	// Each its own storybook CSS.
	const styles = [a, b].map((e) => `tutuca-playground-${e.playground.prefix().match(/^p(\d+)/)[1]}`);
	assert.notEqual(styles[0], styles[1]);
	for (const id of styles) assert.ok(window.document.getElementById(id), id);
	// The lazy one loaded its files and waits to run.
	assert.equal(lazy.getAttribute("data-status"), "idle");
	assert.equal(appOf(lazy), null);
	// A click in one is that one's.
	[...appOf(a).shadowRoot.querySelectorAll("button")].find((x) => x.textContent === "+").click();
	await until(() => shownIn(a) === "−1+");
	assert.equal(shownIn(a), "−1+");
	assert.match(shownIn(b), /Nothing to do\./);
	// Its storybook's timeline gets the click; the other's doesn't.
	const timeline = (e) => e.querySelector("[data-runs]").textContent;
	await until(() => /click → inc\(\)/.test(timeline(a)));
	assert.match(timeline(a), /click → inc\(\)/);
	assert.doesNotMatch(timeline(b), /inc\(\)/);
	// Running one again leaves the other's run alone.
	await a.playground.run();
	await settle();
	assert.match(appOf(a).getAttribute("app-key"), /^p\d+r2\//);
	assert.equal(appOf(b).getAttribute("app-key"), keyB);
	assert.match(shownIn(b), /Nothing to do\./);
	await lazy.start();
	await ready(lazy);
	assert.match(appOf(lazy).getAttribute("app-key"), /^p\d+r1\/Weather\/Lisbon@0$/);
	section.remove();
});

await test("an embedded playground's backend attribute picks wasm-gc, and changing it runs again", async () => {
	const section = window.document.createElement("section");
	section.innerHTML = '<tutuca-playground example="counter" backend="wasm-gc" eager></tutuca-playground>';
	window.document.body.append(section);
	const embed = section.querySelector("tutuca-playground");
	const ready = async (run) => {
		for (let i = 0; i < 600 && !(embed.getAttribute("data-status") === "ready" && embed.playground.state.run === run); i++) await settle(50);
		assert.equal(embed.getAttribute("data-status"), "ready", embed.playground.state.error);
	};
	await ready(1);
	assert.equal(embed.playground.state.backend, "wasm-gc");
	assert.equal(embed.querySelector('[aria-label="Backend"]').value, "wasm-gc");
	const preview = () => embed.querySelector("tutuca-app").shadowRoot.lastElementChild.textContent;
	await until(() => preview() === "−0+");
	assert.equal(preview(), "−0+");
	embed.setAttribute("backend", "js");
	await ready(2);
	assert.equal(embed.playground.state.backend, "js");
	assert.match(embed.querySelector(".pg-status").textContent, /· js ·/);
	await until(() => preview() === "−0+");
	assert.equal(preview(), "−0+");
	section.remove();
});

await test("nothing logged an error", () => {
	assert.deepEqual(consoleErrors, []);
});

console.log(`${compiler.compiles} compiles`);
for (const backend of ["js", "wasm-gc"]) {
	for (const example of examples) {
		const ok = compiles(example, backend);
		const names = example.files.map((f) => fileKey(example, f)).filter(ok);
		const size = sizes.get(sizeKey(names, backend));
		if (size) console.log(`  ${backend} ${example.id}: ${size.ms} ms, ${size.kb} KB of ${backend === "js" ? "JS" : "wasm"}`);
	}
}
if (failures > 0) {
	console.log(`${failures} failed`);
	process.exit(1);
}
process.exit(0);
