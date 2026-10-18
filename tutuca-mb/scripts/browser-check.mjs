// Runs the built pages (just site) in real Chromium through playwright-core: both storybooks (js
// and wasm-gc) run every sequence of every story to its end, every step ok; each playground
// example compiles and runs on both backends, and its stories' sequences pass the same way; the
// mistakes example fails to compile. Every compile runs in the compiler worker: one that falls
// back to the page (compiler.js) fails it. Any console error fails it.
// playwright-core comes from PLAYWRIGHT_CORE, or the npx cache entry whose Chromium is installed.
// Usage: node scripts/browser-check.mjs [--only storybook|playground]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { homedir } from "node:os";

const repo = new URL("../..", import.meta.url).pathname;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

const findPlaywright = () => {
	if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
	const npx = join(homedir(), ".npm/_npx");
	const installed = existsSync(join(homedir(), ".cache/ms-playwright"))
		? readdirSync(join(homedir(), ".cache/ms-playwright"))
		: [];
	for (const dir of existsSync(npx) ? readdirSync(npx) : []) {
		const core = join(npx, dir, "node_modules/playwright-core");
		if (!existsSync(join(core, "browsers.json"))) continue;
		const { browsers } = JSON.parse(readFileSync(join(core, "browsers.json"), "utf8"));
		const rev = browsers.find((b) => b.name === "chromium-headless-shell" || b.name === "chromium")?.revision;
		if (installed.some((d) => d.endsWith(`-${rev}`))) return core;
	}
	throw new Error("no playwright-core with an installed Chromium; set PLAYWRIGHT_CORE");
};
const { chromium } = await import(join(findPlaywright(), "index.mjs"));

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".mi": "application/octet-stream", ".core": "application/octet-stream", ".mbt": "text/plain" };
const server = createServer((req, res) => {
	let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
	let file = join(repo, path);
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
	if (!file.startsWith(repo) || !existsSync(file)) return res.writeHead(404).end();
	res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/tutuca-mb/examples`;

const browser = await chromium.launch();
const problems = [];

// In the page: run every sequence of every story of the storybook under `scope` to its end.
const runAllStories = async (scope) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const root = scope ? document.querySelector(scope) : document;
	const until = async (f, ms = 15000) => {
		for (let t = 0; t < ms; t += 50) {
			const v = f();
			if (v) return v;
			await wait(50);
		}
		return null;
	};
	const button = (text) => [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
	const stories = [...root.querySelectorAll("aside button.font-normal")].map((b) => b.textContent.trim().replace(/\d+$/, "").trim());
	const failures = [];
	let ran = 0;
	for (const name of stories) {
		const pick = [...root.querySelectorAll("aside button.font-normal")].find((b) => b.textContent.trim().startsWith(name));
		pick.click();
		const preview = await until(() => {
			const el = root.querySelector("tutuca-app");
			return el?.shadowRoot?.lastElementChild?.childNodes.length ? el : null;
		});
		if (!preview) {
			failures.push(`${name}: no preview`);
			continue;
		}
		if (/no app for/.test(preview.shadowRoot.textContent)) failures.push(`${name}: ${preview.shadowRoot.textContent}`);
		await wait(100);
		const select = root.querySelector('select[aria-label="Sequence"]');
		// Every sequence, not "(no sequence)"; a story without any runs as it is.
		const named = select ? [...select.options].map((o) => o.value).filter(Boolean) : [];
		const sequences = named.length > 0 ? named : [""];
		for (const seq of sequences) {
			if (select && seq) {
				const s = root.querySelector('select[aria-label="Sequence"]');
				s.value = seq;
				s.dispatchEvent(new Event("change", { bubbles: true }));
				await wait(150);
			}
			root.querySelector('[title="Run to end"]').click();
			// Done when the step list stops changing.
			let last = "";
			for (let stable = 0; stable < 6; ) {
				await wait(100);
				const now = [...root.querySelectorAll("li")].map((l) => l.textContent).join("|");
				stable = now === last ? stable + 1 : 0;
				last = now;
			}
			// Each step's badge, then its label.
			const statuses = [...root.querySelectorAll("li > span.badge:first-child")]
				.filter((b) => /^(ok|failed|skipped)$/.test(b.textContent))
				.map((b) => `${b.textContent} ${b.nextElementSibling?.textContent ?? ""}`);
			ran += statuses.length;
			for (const s of statuses.filter((s) => !s.startsWith("ok"))) failures.push(`${name} › ${seq || "(no sequence)"}: ${s}`);
		}
	}
	return { stories: stories.length, steps: ran, failures };
};

const check = async (label, url, f) => {
	const page = await browser.newPage();
	const errors = [];
	page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(m.text()));
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto(url);
	const result = await f(page);
	await page.close();
	if (errors.length > 0) problems.push(`${label}: console errors: ${errors.slice(0, 3).join(" / ")}`);
	return result;
};

if (only === null || only === "storybook") {
	for (const [label, path] of [["storybook (js)", "storybook/"], ["storybook (wasm-gc)", "storybook/wasm/"]]) {
		const r = await check(label, `${base}/${path}`, async (page) => {
			await page.waitForSelector("aside button.font-normal", { timeout: 30000 });
			return page.evaluate(runAllStories, null);
		});
		console.log(`${label}: ${r.stories} stories, ${r.steps} steps run`);
		assert.ok(r.stories > 50 && r.steps > 100, `${label} ran its stories`);
		for (const f of r.failures) problems.push(`${label}: ${f}`);
	}
}

if (only === null || only === "playground") {
	const examples = ["counter", "todo-list", "composed", "async", "math", "json", "json-schema", "todo", "drawing", "thing-tracker", "tutuca-dev"];
	for (const backend of ["js", "wasm-gc"]) {
		for (const id of [...examples, "mistakes"]) {
			const label = `playground ${id} (${backend})`;
			const r = await check(label, `${base}/playground/?backend=${backend}#${id}`, async (page) => {
				const status = () => page.evaluate(() => document.querySelector("[data-status]")?.getAttribute("data-status"));
				await page.waitForFunction(() => ["idle", "ready", "failed"].includes(document.querySelector("[data-status]")?.getAttribute("data-status")), null, { timeout: 60000 });
				if ((await status()) === "idle") await page.keyboard.press("Control+Enter").catch(() => {});
				if ((await status()) === "idle") await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Run")?.click());
				await page.waitForFunction(() => ["ready", "failed"].includes(document.querySelector("[data-status]")?.getAttribute("data-status")), null, { timeout: 180000 });
				const final = await status();
				// compiler.js's fallback compiles on the page when the worker's stack overflows;
				// the vendored moonc (scripts/vendor-moonc.mjs) never needs it.
				const line = await page.evaluate(() => document.querySelector(".pg-status")?.textContent ?? "");
				if (/compiled on the page/.test(line)) return { final: "fell back to the page", error: line };
				if (id === "mistakes") return { final };
				if (final !== "ready") return { final, error: await page.evaluate(() => document.querySelector("[role=alert]")?.textContent ?? "") };
				await page.waitForSelector("aside button.font-normal", { timeout: 30000 });
				return { final, line, ...(await page.evaluate(runAllStories, "#playground")) };
			});
			if (id === "mistakes") {
				assert.equal(r.final, "failed", `${label} reports its mistakes`);
				console.log(`${label}: fails to compile, as it should`);
				continue;
			}
			if (r.final !== "ready") {
				problems.push(`${label}: ${r.final} ${r.error ?? ""}`);
				continue;
			}
			console.log(`${label}: ${r.stories} stories, ${r.steps} steps run (${r.line})`);
			if (r.stories === 0) problems.push(`${label}: no stories`);
			for (const f of r.failures) problems.push(`${label}: ${f}`);
		}
	}
}

await browser.close();
server.close();
for (const p of problems) console.log(`FAIL ${p}`);
assert.equal(problems.length, 0, "every page passes in Chromium");
console.log("browser check ok");
