// Fetches the in-browser MoonBit compiler, @moonbit/moonc-worker's moonc-web.cjs (a
// js_of_ocaml build of moonc, ~5 MB), into examples/playground/deps/. It must be built from
// the installed moonc, because the playground's payload (scripts/playground-payload.mjs)
// holds .mi/.core files the installed moonc wrote; a worker built from another moonc misreads
// them and blames the user's code. npm has no selector by moonc build, but the worker for
// `moon 0.1.<YYYYMMDD>` is published as `0.1.<YYYYMMDD><n>`, carrying the build in its own
// package.json, so the candidates of that day are fetched until one matches.
//
// The worker is patched as it's vendored (patchMoonc): wasm-gc's link appends lists with
// OCaml's List.append, which recurses once per element, and a large program's lists (the thing
// tracker's: ~6300 elements) overflow a Web Worker's stack (in Chrome under half the page's)
// and node's default. The patch makes it a loop building the same cells in the same order.
// Usage: node scripts/vendor-moonc.mjs [--force]
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = join(ROOT, "examples/playground/deps");
const BLOB = join(DEPS, "moonc-web.cjs");
const STAMP = join(DEPS, "moonc-web.json");

export const installed = () => {
	const raw = execSync("moon version --all", { encoding: "utf8" });
	const moonc = raw.match(/moonc v[\d.]+\+([0-9a-f]+)/);
	const moon = raw.match(/^moon (\S+)/m);
	if (moonc === null || moon === null) throw new Error(`can't read the toolchain:\n${raw}`);
	return { build: moonc[1], day: moon[1].split(".").pop() };
};

// The version of the vendored worker, "0.1.<day><n>+<build>", or null.
export const vendored = () => {
	if (!existsSync(BLOB) || !existsSync(STAMP)) return null;
	try {
		const { version, patches = [] } = JSON.parse(readFileSync(STAMP, "utf8"));
		// One vendored before a patch was added is fetched again.
		return PATCH_NAMES.every((p) => patches.includes(p)) ? version : null;
	} catch {
		return null;
	}
};

// js_of_ocaml's lists: [] is 0, x :: rest is [0, x, rest]. Each patch finds one function by
// its code's shape, whatever its minified name, and fails unless exactly one matches.
const PATCHES = [
	{
		// List.append (@): `let rec append l1 l2 = match l1 with [] -> l2 | h :: t -> h :: append t l2`.
		// The loop allocates the same fresh [0, h, _] cell per element of l1, front to back, and
		// shares l2 as the last tail, as the recursion does (also when l2 is []).
		name: "List.append",
		shape: /function\s+([\w$]+)\(a,b\)\{if\(!a\)return b;var\s+c=a\[1\];return\[0,c,\1\(a\[2\],b\)\]\}/g,
		loop: (f) =>
			`function ${f}(a,b){/*tutuca: List.append as a loop*/if(!a)return b;var r=[0,a[1],b],t=r;for(a=a[2];a;a=a[2]){var n=[0,a[1],b];t[2]=n;t=n}return r}`,
	},
];
export const PATCH_NAMES = PATCHES.map((p) => p.name);

// moonc-web.cjs's source with every patch applied.
export const patchMoonc = (source) => {
	let out = source;
	for (const { name, shape, loop } of PATCHES) {
		const found = [...out.matchAll(shape)];
		if (found.length !== 1)
			throw new Error(
				`moonc-web.cjs: ${found.length} functions look like ${name}, not 1 (the worker's code changed; update PATCHES in scripts/vendor-moonc.mjs)`,
			);
		const [whole, f] = found[0];
		out = out.replace(whole, () => loop(f));
	}
	return out;
};

const fetchWorker = (version) => {
	const work = mkdtempSync(join(tmpdir(), "tutuca-moonc-"));
	try {
		const tgz = execSync(`npm pack @moonbit/moonc-worker@${version} --silent`, {
			cwd: work,
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.pop();
		execSync(`tar xzf "${tgz}"`, { cwd: work });
		const own = JSON.parse(readFileSync(join(work, "package/package.json"), "utf8")).version;
		return { own, blob: readFileSync(join(work, "package/moonc-web.cjs")) };
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
};

export const ensureMoonc = ({ force = false } = {}) => {
	const { build, day } = installed();
	const have = vendored();
	if (!force && have?.endsWith(`+${build}`)) return have;
	const versions = JSON.parse(
		execSync("npm view @moonbit/moonc-worker versions --json", { encoding: "utf8" }),
	);
	const sameDay = versions.filter((v) => v.startsWith(`0.1.${day}`)).reverse();
	const candidates = [...sameDay, ...versions.slice(-3).reverse().filter((v) => !sameDay.includes(v))];
	for (const version of candidates) {
		const { own, blob } = fetchWorker(version);
		if (own.endsWith(`+${build}`)) {
			mkdirSync(DEPS, { recursive: true });
			writeFileSync(BLOB, patchMoonc(blob.toString("utf8")));
			writeFileSync(STAMP, `${JSON.stringify({ version: own, patches: PATCH_NAMES }, null, 2)}\n`);
			return own;
		}
		console.log(`@moonbit/moonc-worker@${own} is not built from moonc ${build}; trying the next`);
	}
	throw new Error(
		`npm publishes no @moonbit/moonc-worker built from the installed moonc (${build}) yet`,
	);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	console.log(`examples/playground/deps/moonc-web.cjs: @moonbit/moonc-worker@${ensureMoonc({ force: process.argv.includes("--force") })}`);
}
