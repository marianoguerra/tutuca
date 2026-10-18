// Differential check of the port against the JS tutuca: every story of both storybooks is
// rendered headless in jsdom, and the DOM of its preview is compared after the initial render
// and after every step of every sequence, with the status of each step.
// JS runs on src/test/pbt.js's Driver (as checkStory does: a fresh one per sequence) and
// src/storybook/stories.js's runStep; the port on examples/storybook/differential, the
// storybook page's runners without the UI (moon build --target js first).
// Normalized away: tutuca's metadata comments (§…§), the attributes that route handlers (JS
// data-eid, the port's data-h and data-tutuca-host), whitespace-only text nodes, runs of
// whitespace inside text, and attribute order. Everything else must match: tags, text,
// attribute values, form fields' value and checked, element order.
// Usage: node scripts/differential.mjs [--only <id substring>] [--verbose] [--dump <dir>]
// (--dump writes each compared story's points, normalized, to <dir>/<id>.{js,port}.txt.)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "../../node_modules/jsdom/lib/api.js";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const verbose = args.includes("--verbose");
const dumpDir = args.includes("--dump") ? args[args.indexOf("--dump") + 1] : null;
// --ui runs only the storybook UI's comparison, --no-ui only the previews'.
// A child process runs the UI comparison for the story ids in DIFF_UI_IDS (see below).
const childIds = process.env.DIFF_UI_IDS ? JSON.parse(process.env.DIFF_UI_IDS) : null;
const previews = !args.includes("--ui") && childIds === null;
const ui = !args.includes("--no-ui");

// Stories whose state is generated: JS draws it with fast-check, the port with splitmix, so
// the same seed gives different states.
const GENERATED = "generated state: JS draws it with fast-check, the port with splitmix";
// The lines of a preview or the UI, with the allowed differences rewritten (see NORMALIZED).
const linesOf = (_id, root, side) => normalized(lines(root), side);

// Both run in the same document; the date is pinned (the stories ask "today" of handlers
// that answer a fixed day, this is for anything else that reads the clock).
const FIXED_NOW = Date.UTC(2026, 11, 24, 12, 0, 0);
const RealDate = Date;
globalThis.Date = class extends RealDate {
	constructor(...a) {
		super(...(a.length === 0 ? [FIXED_NOW] : a));
	}
	static now() {
		return FIXED_NOW;
	}
};
const dom = new JSDOM("<!doctype html><body></body>");
const { window } = dom;
Object.assign(globalThis, {
	window,
	document: window.document,
	customElements: window.customElements,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Event: window.Event,
});
window.Date = globalThis.Date;
const errors = [];
const consoleError = console.error;
console.error = (...a) => errors.push(a.join(" "));

const repo = new URL("../../", import.meta.url).pathname;
const fc = (await import(`${repo}node_modules/fast-check/lib/fast-check.js`)).default;
const { books } = await import(`${repo}storybook.books.js`);
const { prepareStory, runStep, stepText } = await import(`${repo}src/storybook/stories.js`);
const { Driver, describeProblems } = await import(`${repo}src/test/pbt.js`);
const port = await import(
	new URL("../_build/js/debug/build/examples/storybook/differential/differential.js", import.meta.url).href
);

// --- normalized DOM -------------------------------------------------------------------------

const IGNORED_ATTRS = new Set(["data-eid", "data-h", "data-tutuca-host"]);
const SVG = "http://www.w3.org/2000/svg";
const MATHML = "http://www.w3.org/1998/Math/MathML";
const isMeta = (n) => n.nodeType === 8 && /^§.*§$/s.test(n.data);
// The lines of a node's children: one per element (with its attributes) or text, indented by depth.
const lines = (parent, depth = 0, out = []) => {
	let text = null;
	const flush = () => {
		if (text !== null && text.trim() !== "") out.push(`${"  ".repeat(depth)}"${text.replace(/\s+/g, " ")}"`);
		text = null;
	};
	for (const n of parent.childNodes) {
		if (n.nodeType === 3) text = (text ?? "") + n.data;
		else if (n.nodeType === 8) {
			if (isMeta(n)) continue;
			flush();
			out.push(`${"  ".repeat(depth)}<!--${n.data}-->`);
		} else if (n.nodeType === 1) {
			flush();
			out.push(`${"  ".repeat(depth)}${open(n)}`);
			lines(n, depth + 1, out);
		}
	}
	flush();
	return out;
};
const open = (el) => {
	const ns = el.namespaceURI === SVG ? "svg:" : el.namespaceURI === MATHML ? "math:" : "";
	const attrs = [...el.attributes]
		.filter((a) => !IGNORED_ATTRS.has(a.name))
		.map((a) => `${a.name}="${a.value}"`)
		.sort();
	const tag = el.localName;
	if (tag === "input" || tag === "textarea" || tag === "select") attrs.push(`.value="${el.value}"`);
	if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) attrs.push(`.checked=${el.checked}`);
	return `<${ns}${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
};

// The port's snake_case names camelCased, a trailing _ (MoonBit's way around a reserved word)
// dropped: JSON keys, path segments and lines that only name fields; not data.
const SNAKE = "[a-z][a-z0-9]*(?:_[a-z0-9]+)+_?|[a-z][a-z0-9]*_";
const snakeToCamel = (line) =>
	line
		// JSON keys, and path segments (`.quick_add.setText()`).
		.replace(new RegExp(`"(${SNAKE})":`, "g"), (_, w) => `"${camel(w)}":`)
		.replace(new RegExp(`\\.(${SNAKE})\\b`, "g"), (_, w) => `.${camel(w)}`)
		// A list of names, as a spec's methods row (in a state's JSON too).
		.replace(/"((?:[a-z][a-zA-Z0-9_]*, )+[a-z][a-zA-Z0-9_]*)"/g, (_, list) => `"${list.split(", ").map(camel).join(", ")}"`)
		// A dev node's label in a state's JSON.
		.replace(new RegExp(`"label": "(${SNAKE})"`, "g"), (_, w) => `"label": "${camel(w)}"`)
		// An instance's detail: "empty_text “Nothing to show.” · nodes list of 6".
		.replace(new RegExp(`(^\\s*"|· )(${SNAKE}) `, "g"), (_, pre, w) => `${pre}${camel(w)} `)
		// A line that only names fields: a dev node's label, a spec's methods.
		.replace(new RegExp(`^(\\s*)"((?:${SNAKE}|[a-zA-Z][a-zA-Z0-9]*)(?:, (?:${SNAKE}|[a-zA-Z][a-zA-Z0-9]*))*)"$`), (_, ws, ws2) =>
			`${ws}"${ws2.split(", ").map(camel).join(", ")}"`,
		);
// snake_case to camelCase, a trailing _ (MoonBit's way around a reserved word) dropped.
const camel = (name) => name.replace(/_$/, "").replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
// What is rewritten before comparing (on the port's side, or both), with why: the allowlist.
const NORMALIZED = [
	{
		reason:
			"MoonBit names are snake_case (is_open, project_id, ref_), JS's camelCase (isOpen, projectId, ref): the names the port shows (JSON keys, paths, field labels) are compared camelCased",
		apply: (out) => out.map(snakeToCamel),
	},
	{
		reason:
			"a view node's code (the tokens of a spec's \"view …\" rows, in a state's JSON) is each implementation's own builder calls (JS's $if(field(\"isEditing\"), h(\"div\", …)), MoonBit's if_(h(\"div\", …))): compared as #",
		apply: (out) => out.map(viewTokens),
		both: true,
	},
	{
		reason:
			"a dev node's ref is an id into each implementation's table of inspected values, numbered as values are inspected: refs are compared as #",
		apply: (out) => out.map((line) => line.replace(/"ref": \d+/g, '"ref": #')),
		both: true,
	},
];
// A state's JSON line with the tokens of every "view …" dev node replaced by "#".
const viewTokens = (line) => {
	let out = line;
	for (let at = out.indexOf('"label": "view '); at >= 0; at = out.indexOf('"label": "view ', at + 1)) {
		const t = out.indexOf('"tokens": [', at);
		if (t < 0) break;
		let i = t + '"tokens": ['.length;
		for (let depth = 1; depth > 0 && i < out.length; i++) {
			if (out[i] === "[") depth++;
			else if (out[i] === "]") depth--;
			else if (out[i] === '"') for (i++; i < out.length && out[i] !== '"'; i++) if (out[i] === "\\") i++;
		}
		out = `${out.slice(0, t)}"tokens": "#"${out.slice(i)}`;
	}
	return out;
};
// The lines with the allowed differences rewritten, on the port's side or both.
const normalized = (out, side) => {
	for (const n of NORMALIZED) if (side === "port" || n.both) out = n.apply(out);
	return out;
};

// --- running both ---------------------------------------------------------------------------

// The points of a story: { label, html: [lines], status } for the initial render, then each step.
const jsPoints = (story) => {
	const points = [];
	const { root } = prepareStory(story, { fc });
	const driver = new Driver({ root, document: window.document });
	const initial = describeProblems(driver.problems);
	points.push({ label: "initial", status: initial.length ? "failed" : "ok", html: linesOf(story.id, driver.rootNode, "js") });
	driver.host.stop?.();
	for (const [name, steps] of Object.entries(story.sequences)) {
		const { root } = prepareStory(story, { fc });
		const d = new Driver({ root, document: window.document });
		steps.forEach((s, i) => {
			const { status } = runStep(d, s);
			points.push({ label: `${name} › ${i + 1}. ${stepText(s)}`, status, html: linesOf(story.id, d.rootNode, "js") });
		});
		d.host.stop?.();
	}
	return points;
};
const portPoints = (id) => {
	const points = [];
	const root = window.document.createElement("main");
	port.mount(id, root);
	const initial = port.problems(id);
	points.push({ label: "initial", status: initial.length ? "failed" : "ok", html: linesOf(id, root, "port") });
	for (const name of port.sequences(id)) {
		port.load(id, name);
		const labels = port.steps(id);
		for (let i = 0; i < labels.length; i++) {
			const [status] = port.forward(id).split("\t");
			points.push({ label: `${name} › ${i + 1}. ${labels[i]}`, status, html: linesOf(id, root, "port") });
		}
	}
	return points;
};

const commonPrefix = (a, b) => {
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return i;
};
// A long line around position at.
const clip = (line, at) => {
	if (line.length <= 160) return line;
	const start = Math.max(0, at - 60);
	return `${start > 0 ? "…" : ""}${line.slice(start, start + 140)}${start + 140 < line.length ? "…" : ""}`;
};
// The first difference of two runs, or null.
const firstDifference = (js, mb) => {
	for (let p = 0; p < Math.max(js.length, mb.length); p++) {
		const a = js[p];
		const b = mb[p];
		if (a === undefined || b === undefined) {
			return `${js.length} points in JS, ${mb.length} in the port (at ${(a ?? b).label})`;
		}
		if (a.status !== b.status) return `${a.label}: step ${a.status} in JS, ${b.status} in the port (${b.label})`;
		for (let i = 0; i < Math.max(a.html.length, b.html.length); i++) {
			if (a.html[i] !== b.html[i]) {
				const context = a.html.slice(Math.max(0, i - 2), i).map((l) => `      ${clip(l, 0)}`);
				const at = commonPrefix(a.html[i] ?? "", b.html[i] ?? "");
				return [
					`${a.label}, line ${i + 1}:`,
					...context,
					`    JS:   ${a.html[i] === undefined ? "(nothing)" : clip(a.html[i], at)}`,
					`    port: ${b.html[i] === undefined ? "(nothing)" : clip(b.html[i], at)}`,
				].join("\n");
			}
		}
	}
	return null;
};

const jsStories = new Map(books.flatMap((b) => b.stories).map((s) => [s.id, s]));
const ids = [...new Set([...jsStories.keys(), ...port.ids()])].filter((id) => only === null || id.includes(only));
const counts = { identical: 0, differs: 0, excluded: 0 };
const failures = [];
for (const id of previews ? ids : []) {
	const story = jsStories.get(id);
	let verdict;
	if (story === undefined || !port.ids().includes(id)) verdict = ["excluded", `only in ${story ? "JS" : "the port"}`];
	else if (story.arbitrary !== undefined) verdict = ["excluded", GENERATED];
	else {
		let diff;
		try {
			const js = jsPoints(story);
			const mb = portPoints(id);
			if (dumpDir !== null) {
				mkdirSync(dumpDir, { recursive: true });
				const text = (points) => points.map((p) => `== ${p.label} [${p.status}]\n${p.html.join("\n")}`).join("\n");
				const name = id.replace(/[^\w-]+/g, "_");
				writeFileSync(join(dumpDir, `${name}.js.txt`), text(js));
				writeFileSync(join(dumpDir, `${name}.port.txt`), text(mb));
			}
			diff = firstDifference(js, mb);
		} catch (e) {
			diff = `threw: ${e?.stack ?? e}`;
		}
		if (diff === null) verdict = ["identical"];
		else verdict = ["differs", diff];
	}
	const [kind, detail] = verdict;
	counts[kind]++;
	if (kind === "differs") failures.push(id);
	if (kind !== "identical" || verbose) console.log(`${kind.padEnd(9)} ${id}${detail ? `\n  ${detail}` : ""}`);
}

// --- the storybook UI -------------------------------------------------------------------------
// For a few stories, the storybook UI itself in both, the preview's content left out (it is
// the <tutuca-app>'s shadow root): the story picked, each tab, after "Run to end", and after a
// stress run (seed 1, the panel's defaults).

// Every story but the generated ones.
const UI_STORIES = books
	.flatMap((b) => b.stories)
	.filter((s) => s.arbitrary === undefined)
	.map((s) => s.id);


const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits until root's DOM stops changing.
const settled = async (root) => {
	let last = "";
	for (let stable = 0, t = 0; stable < 4 && t < 400; t++) {
		await tick(10);
		const now = root.innerHTML;
		stable = now === last ? stable + 1 : 0;
		last = now;
	}
};
const uiLines = (root, side) => normalized(lines(root), side);
const FAILED_STRESS =
	"when both stress runs fail, how many runs it took, the error and the shrunk counterexample come from each implementation's generator (fast-check's, splitmix's): compared as #, the failing itself compared";
// A stress run's status badge in a point's lines.
const stressStatus = (html) => {
	const i = html.findIndex((l) => l.trim() === '<span class="badge">');
	return i < 0 ? null : html[i + 1].trim();
};
// When both stress runs failed, the parts that come from each implementation's random
// generator (fast-check's, splitmix's): how many runs it took, the error, the shrunk
// counterexample's commands. Both must fail; what they found isn't compared.
const failedStress = (html, js, mb, label) => {
	const at = (points) => points.find((p) => p.label === label);
	if (stressStatus(at(js).html) !== '"failed"' || stressStatus(at(mb).html) !== '"failed"') return html;
	const out = [];
	for (let i = 0; i < html.length; i++) {
		const line = html[i];
		if (/^\s*"\d+ \/ \d+ runs"$/.test(line)) out.push(line.replace(/\d+ \//, "# /"));
		else if (line.includes("<progress ")) out.push(line.replace(/ value="\d+"/, ' value="#"'));
		else if (line.includes('<pre class="whitespace-pre-wrap rounded bg-error/10 p-3 text-xs text-error">')) {
			out.push(line, html[i + 1].replace(/".*"/, '"#"'));
			i++;
		} else if (line.includes('<ol class="list-decimal pl-6 font-mono text-xs">')) {
			out.push(line, `${line.match(/^\s*/)[0]}  #`);
			const depth = line.match(/^\s*/)[0].length;
			while (i + 1 < html.length && html[i + 1].match(/^\s*/)[0].length > depth) i++;
		} else out.push(line);
	}
	return out;
};
// The storybook UI under root, in its window: picks, clicks and snapshots.
const driverOf = (win, root, side) => {
	const click = (el) => {
		if (!el) throw new Error("nothing to click");
		el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, composed: true }));
	};
	const byText = (selector, text) =>
		[...root.querySelectorAll(selector)].find((n) => n.textContent.trim() === text);
	return {
		pick: (id) => click(root.querySelector(`aside li button[title="${id}"]`)),
		tab: (name) => click(byText('[role="tab"]', name)),
		toEnd: () => click(root.querySelector('[title="Run to end"]')),
		stress: () => click(byText("button", "Run stress test")),
		running: () => byText("span.badge", "running") !== undefined,
		settled: () => settled(root),
		lines: () => uiLines(root, side),
	};
};
// Snapshots of the UI for story id: [label, lines].
const uiPoints = async (d, id) => {
	const points = [];
	const snap = async (label) => {
		await d.settled();
		points.push({ label, status: "ok", html: d.lines() });
	};
	d.pick(id);
	d.tab("Steps");
	await snap("picked, Steps");
	d.tab("Stress test");
	await snap("Stress test");
	d.tab("Dev");
	await snap("Dev");
	d.tab("Steps");
	await d.settled();
	d.toEnd();
	await snap("after Run to end");
	d.tab("Dev");
	await snap("Dev, after Run to end");
	d.tab("Stress test");
	await d.settled();
	d.stress();
	for (let i = 0; i < 600 && d.running(); i++) await tick(20);
	await snap("after a stress run");
	return points;
};

// Each batch of stories runs in a child process of its own, on fresh windows: a storybook
// keeps what it ran, so one process for all of them runs out of memory.
const UI_BATCH = 12;
const UI_JOBS = 3;
const uiIds = UI_STORIES.filter((id) => only === null || id.includes(only));
const uiCounts = { identical: 0, differs: 0 };
if (ui && childIds === null) {
	const { spawn } = await import("node:child_process");
	const batches = [];
	for (let i = 0; i < uiIds.length; i += UI_BATCH) batches.push(uiIds.slice(i, i + UI_BATCH));
	if (batches.length === 0) batches.push([]);
	const run = (batch, first) =>
		new Promise((resolve) => {
			const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args.filter((a) => a !== "--ui")], {
				env: { ...process.env, DIFF_UI_IDS: JSON.stringify(batch), DIFF_UI_SIDEBAR: first ? "1" : "" },
				stdio: ["ignore", "pipe", "inherit"],
			});
			let out = "";
			child.stdout.on("data", (d) => {
				out += d;
			});
			child.on("close", (code) => resolve({ out, code }));
		});
	const results = new Array(batches.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(UI_JOBS, batches.length) }, async () => {
			while (next < batches.length) {
				const i = next++;
				results[i] = await run(batches[i], i === 0);
			}
		}),
	);
	for (const { out, code } of results) {
		const body = out.split("\n__UI_DONE__")[0];
		if (body.trim() !== "") console.log(body.replace(/\n$/, ""));
		for (const line of body.split("\n")) {
			if (/^identical +UI: /.test(line) && !line.endsWith("nothing picked")) uiCounts.identical++;
			if (/^differs +UI: /.test(line)) uiCounts.differs++;
		}
		if (code !== 0 || !out.includes("__UI_DONE__")) failures.push(`UI batch (exit ${code})`);
	}
}

if (ui && childIds !== null) {
	// JS's storybook in a window of its own: both define <tutuca-app>.
	const jsWin = new JSDOM("<!doctype html><body></body>").window;
	jsWin.Date = globalThis.Date;
	const jsRoot = jsWin.document.createElement("div");
	jsWin.document.body.append(jsRoot);
	const { startStorybook } = await import(`${repo}src/storybook/index.js`);
	startStorybook({ document: jsWin.document, rootNode: jsRoot, fc, books });
	// The port's storybook page, on the shared window's #storybook.
	const portRoot = window.document.createElement("div");
	portRoot.id = "storybook";
	window.document.body.append(portRoot);
	await import(new URL("../_build/js/debug/build/examples/storybook/storybook.js", import.meta.url).href);
	const jsUi = driverOf(jsWin, jsRoot, "js");
	const portUi = driverOf(window, portRoot, "port");
	await jsUi.settled();
	await portUi.settled();
	const sidebar = firstDifference(
		[{ label: "the sidebar, nothing picked", status: "ok", html: jsUi.lines() }],
		[{ label: "the sidebar, nothing picked", status: "ok", html: portUi.lines() }],
	);
	if (process.env.DIFF_UI_SIDEBAR) {
		console.log(`${(sidebar === null ? "identical" : "differs").padEnd(9)} UI: nothing picked${sidebar ? `\n  ${sidebar}` : ""}`);
		if (sidebar !== null) failures.push("UI");
	}
	for (const id of childIds) {
		let diff;
		try {
			const js = await uiPoints(jsUi, id);
			const mb = await uiPoints(portUi, id);
			for (const points of [js, mb]) for (const p of points) p.html = failedStress(p.html, js, mb, p.label);
			if (dumpDir !== null) {
				mkdirSync(dumpDir, { recursive: true });
				const text = (points) => points.map((p) => `== ${p.label}\n${p.html.join("\n")}`).join("\n");
				const name = `UI_${id.replace(/[^\w-]+/g, "_")}`;
				writeFileSync(join(dumpDir, `${name}.js.txt`), text(js));
				writeFileSync(join(dumpDir, `${name}.port.txt`), text(mb));
			}
			diff = firstDifference(js, mb);
		} catch (e) {
			diff = `threw: ${e?.stack ?? e}`;
		}
		if (diff !== null) failures.push(`UI ${id}`);
		console.log(`${(diff === null ? "identical" : "differs").padEnd(9)} UI: ${id}${diff ? `\n  ${diff}` : ""}`);
	}
}

console.error = consoleError;
if (childIds !== null) {
	console.log("\n__UI_DONE__");
	process.exit(failures.length > 0 ? 1 : 0);
}
console.log("\nallowlist (rewritten before comparing, in the previews and the UI):");
for (const { reason } of NORMALIZED) console.log(`  ${reason}`);
console.log(`  ${FAILED_STRESS}`);
if (previews) console.log(`\npreviews: ${counts.identical} identical, ${counts.differs} differ, ${counts.excluded} excluded`);
if (ui) console.log(`storybook UI: ${uiCounts.identical} identical, ${uiCounts.differs} differ (of ${uiIds.length} stories, generated ones excepted)`);
if (errors.length > 0) console.log(`console errors:\n${[...new Set(errors)].slice(0, 10).join("\n")}`);
process.exit(failures.length > 0 ? 1 : 0);
