import assert from "node:assert/strict";
import test from "node:test";
import {
	booksOf,
	importSpecifiers,
	linkSources,
	loadSources,
	mapSpecifiers,
	relativeName,
} from "../../src/playground/sources.js";

test("importSpecifiers finds static, re-export, side-effect and dynamic imports, not comments", () => {
	const code = `import { a } from "./a.js";
import * as b from '../b.js';
import "./side.js";
export { c } from "./c.js";
export * from "tutuca";
const d = await import("./d.js");
// import { no } from "./comment.js";
/* import "./block.js"; */
const text = "imported from somewhere";`;
	assert.deepEqual(importSpecifiers(code), [
		"./a.js",
		"../b.js",
		"./side.js",
		"./c.js",
		"tutuca",
		"./d.js",
	]);
});

test("mapSpecifiers keeps quotes and everything around the specifier", () => {
	const code = `import { a } from './a.js';\nexport * from "./b.js";`;
	assert.equal(
		mapSpecifiers(code, (s) => s.toUpperCase()),
		`import { a } from './A.JS';\nexport * from "./B.JS";`,
	);
});

test("relativeName names files from the entry's folder", () => {
	const base = "https://x.test/components/todo/stories.js";
	assert.equal(relativeName(base, base), "stories.js");
	assert.equal(relativeName("https://x.test/components/todo/panels/a.js", base), "panels/a.js");
	assert.equal(
		relativeName("https://x.test/components/common/files.js", base),
		"../common/files.js",
	);
});

const FILES = {
	"https://x.test/app/main.js": `import { two } from "./two.js";\nimport { lib } from "../src/lib.js";\nimport { x } from "tutuca";\nexport default two + lib;`,
	"https://x.test/app/two.js": `import { one } from "./util/one.js";\nexport const two = one + 1;`,
	"https://x.test/app/util/one.js": `export const one = 1;`,
	"https://x.test/src/lib.js": `export const lib = 10;`,
};
const fakeFetch = (url) => {
	const code = FILES[url];
	return Promise.resolve(
		code === undefined
			? { ok: false, status: 404 }
			: { ok: true, status: 200, text: () => Promise.resolve(code) },
	);
};
const isExternal = (url) => url.startsWith("https://x.test/src/");

test("loadSources follows relative imports, entry first, and stops at external files", async () => {
	const files = await loadSources("https://x.test/app/main.js", { fetch: fakeFetch, isExternal });
	assert.deepEqual(
		files.map((f) => f.name),
		["main.js", "two.js", "util/one.js"],
	);
	assert.equal(files[2].code, FILES["https://x.test/app/util/one.js"]);
});

test("loadSources reports files it can't load", async () => {
	await assert.rejects(
		loadSources("https://x.test/app/missing.js", { fetch: fakeFetch, isExternal }),
		/can't load https:\/\/x.test\/app\/missing.js: 404/,
	);
});

test("linkSources links dependencies first, external files by URL, bare specifiers as they are", async () => {
	const files = await loadSources("https://x.test/app/main.js", { fetch: fakeFetch, isExternal });
	const made = [];
	const revoked = [];
	const { entry, revoke } = linkSources(files, {
		createUrl: (code) => {
			made.push(code);
			return `blob:${made.length}`;
		},
		revokeUrl: (url) => revoked.push(url),
	});
	assert.equal(entry, "blob:3");
	assert.equal(made[0], FILES["https://x.test/app/util/one.js"]);
	assert.match(made[1], /from "blob:1"/);
	assert.match(made[2], /from "blob:2"/);
	assert.match(made[2], /from "https:\/\/x.test\/src\/lib.js"/);
	assert.match(made[2], /from "tutuca"/);
	revoke();
	assert.deepEqual(revoked, ["blob:1", "blob:2", "blob:3"]);
});

test("linkSources refuses import cycles, naming them", () => {
	const files = [
		{ url: "https://x.test/a.js", name: "a.js", code: `import "./b.js";` },
		{ url: "https://x.test/b.js", name: "b.js", code: `import "./a.js";` },
	];
	assert.throws(() => linkSources(files, { createUrl: () => "blob:x" }), /a\.js → b\.js → a\.js/);
});

test("linked modules run: data URLs stand in for blobs", async () => {
	const files = [
		{ url: "https://x.test/main.js", code: `import { n } from "./n.js";\nexport default n * 2;` },
		{ url: "https://x.test/n.js", code: `export const n = 21;` },
	];
	const { entry } = linkSources(files, {
		createUrl: (code) => `data:text/javascript,${encodeURIComponent(code)}`,
		revokeUrl: () => {},
	});
	assert.equal((await import(entry)).default, 42);
});

test("booksOf finds the books a module exports, default first", () => {
	const book = (title) => ({ title, stories: [] });
	const mod = {
		extra: book("Extra"),
		default: book("Main"),
		helper: () => {},
		other: { title: "x" },
	};
	assert.deepEqual(
		booksOf(mod).map((b) => b.title),
		["Main", "Extra"],
	);
});
