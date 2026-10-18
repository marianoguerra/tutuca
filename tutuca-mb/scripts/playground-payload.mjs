// Assembles what the playground compiles a run against, in examples/playground/payload/<target>/
// for each backend (js, wasm-gc):
// the core library's interfaces (.mi), the interfaces of the link closure's tutuca-mb packages,
// the closure's ordered .core files (examples/playground/link, link_wasm on wasm-gc) and
// manifest.json, which says which is which.
// A run is a user package compiled in the browser by @moonbit/moonc-worker against these and
// linked with them: the prebuilt host + user module split, so the user's package never
// recompiles tutuca and its imports alias exactly as listed in FRAMEWORK and BACKENDS.
//
// The payload and the compiler are a pair: the .mi/.core files come from the installed moonc
// and the browser compiler must be built from the same one (scripts/vendor-moonc.mjs checks).
// Usage: node scripts/playground-payload.mjs   (runs the release build it needs)
import { execSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOON_HOME = process.env.MOON_HOME || join(process.env.HOME, ".moon");
const OUT = join(ROOT, "examples/playground/payload");

// The packages a run may import directly. The browser compiler aliases each by the last
// segment of its path, as moon does, unless it's named "path:alias": these are @tutuca,
// @vdom, @memdom, @testing, @dev, @storybook, the backend's shell (@browser and @web on js,
// @wasm on wasm-gc) and @run, the framework. The example packages the component libraries
// build on (examples/common, json_editor, todo) aren't here: the playground compiles them
// with the library (library.js). The core library's packages come from the std bundle.
const FRAMEWORK = [
	"tutuca.mi",
	"vdom/vdom.mi",
	"vdom/memdom/memdom.mi",
	"testing/testing.mi",
	"dev/dev.mi",
	"storybook/storybook.mi",
];
// Per backend: the link root, whose link closure a run is linked against (a run takes its
// place), and the packages a run imports besides the framework.
export const BACKENDS = {
	js: {
		link: "examples/playground/link",
		direct: ["browser/browser.mi", "storybook/web/web.mi", "examples/playground/run/run.mi"],
	},
	"wasm-gc": {
		link: "examples/playground/link_wasm",
		direct: ["wasm/wasm.mi", "examples/playground/run_wasm/run_wasm.mi:run"],
	},
};
const pathOf = (direct) => direct.split(":")[0];

const walk = (dir, ext, base = dir, out = []) => {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, ext, base, out);
		else if (entry.endsWith(ext)) out.push(path.slice(base.length + 1));
	}
	return out;
};

// The .core files of the link closure, in link order, without the link root itself.
const linkClosure = (TARGET, LINK, BUILD) => {
	const dry = execSync(`moon build --target ${TARGET} --release --dry-run ${LINK}`, {
		cwd: ROOT,
		encoding: "utf8",
	});
	const line = dry.split("\n").find((l) => l.includes("link-core"));
	if (line === undefined) throw new Error(`no link-core step for ${LINK}`);
	return [...line.matchAll(/'?([^ ']+\.core)'?/g)]
		.map((m) => m[1])
		.filter((path) => !path.includes(`/${LINK}/`))
		.map((path) =>
			path
				.replace("$MOON_HOME", MOON_HOME)
				.replace(new RegExp(`^\\./_build/${TARGET}/release/build/`), `${BUILD}/`),
		);
};

const toolchain = () => {
	const raw = execSync("moon version --all", { encoding: "utf8" });
	return raw.match(/moonc (v[\d.]+\+[0-9a-f]+)/)?.[1] ?? "";
};

// Assembles payload/<target>/ for `target`.
export const assemble = (target, { built = false } = {}) => {
	const { link, direct: own } = BACKENDS[target];
	const DIRECT = [...FRAMEWORK, ...own];
	const out = join(OUT, target);
	const STD = join(MOON_HOME, `lib/core/_build/${target}/release/bundle`);
	const BUILD = join(ROOT, `_build/${target}/release/build`);
	if (!built)
		execSync(`moon build --target ${target} --release ${link}`, { cwd: ROOT, stdio: "inherit" });
	rmSync(out, { recursive: true, force: true });
	const copy = (from, to) => {
		mkdirSync(dirname(join(out, to)), { recursive: true });
		cpSync(from, join(out, to));
	};
	const std = walk(STD, ".mi");
	for (const rel of std) copy(join(STD, rel), `std/${rel}`);
	const closure = linkClosure(target, link, BUILD);
	// The interfaces of the closure's packages: what the user's package may see.
	const lib = closure
		.filter((abs) => abs.startsWith(`${BUILD}/`))
		.map((abs) => abs.slice(BUILD.length + 1).replace(/\.core$/, ".mi"));
	for (const rel of lib) copy(join(BUILD, rel), `lib/${rel}`);
	const cores = closure.map((abs, i) => {
		const rel = `cores/${String(i).padStart(2, "0")}_${abs.split("/").slice(-2).join("_")}`;
		copy(abs, rel);
		return rel;
	});
	const missing = DIRECT.map(pathOf).filter((rel) => !lib.includes(rel));
	if (missing.length > 0) throw new Error(`not in ${link}'s closure: ${missing.join(", ")}`);
	const manifest = {
		moonc: toolchain(),
		target,
		std: std.map((rel) => `std/${rel}`),
		direct: DIRECT.map((rel) => `lib/${rel}`),
		lib: lib.filter((rel) => !DIRECT.map(pathOf).includes(rel)).map((rel) => `lib/${rel}`),
		cores,
	};
	writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
	return manifest;
};

if (import.meta.url === `file://${process.argv[1]}`) {
	rmSync(OUT, { recursive: true, force: true });
	for (const target of Object.keys(BACKENDS)) {
		const m = assemble(target, { built: process.argv.includes("--built") });
		console.log(
			`examples/playground/payload/${target}: ${m.std.length} std .mi, ${m.direct.length + m.lib.length} tutuca-mb .mi, ${m.cores.length} cores (moonc ${m.moonc})`,
		);
	}
}
