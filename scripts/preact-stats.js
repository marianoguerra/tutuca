// Clones the latest stable Preact release tag into a temp dir, builds it and prints
// size stats per bundle (raw / gzip / brotli) plus lines of code.
//
//   node scripts/preact-stats.js [tag] [--keep] [--json]
//
// Minified bundles report no line count (it's meaningless); instead the sources each
// bundle was built from are counted through its sourcemap's sourcesContent.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const REPO = "https://github.com/preactjs/preact.git";
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const asJson = args.includes("--json");
const tagArg = args.find((a) => !a.startsWith("--"));

const log = (msg) => process.stderr.write(`${msg}\n`);

function run(cmd, cmdArgs, cwd) {
	return execFileSync(cmd, cmdArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function latestStableTag() {
	const out = run("git", ["ls-remote", "--tags", "--refs", REPO]);
	const tags = out
		.split("\n")
		.map((line) => line.split("refs/tags/")[1])
		.filter((tag) => tag && /^v?\d+\.\d+\.\d+$/.test(tag));
	const key = (tag) => tag.replace(/^v/, "").split(".").map(Number);
	tags.sort((a, b) => {
		const [ka, kb] = [key(a), key(b)];
		return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
	});
	return tags.at(-1);
}

function build(dir) {
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const usePnpm = existsSync(join(dir, "pnpm-lock.yaml")) || pkg.packageManager?.startsWith("pnpm");
	// --ignore-scripts skips husky and playwright browser downloads from `prepare`.
	if (usePnpm) {
		run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], dir);
		run("pnpm", ["run", "build"], dir);
	} else {
		run(
			"npm",
			[existsSync(join(dir, "package-lock.json")) ? "ci" : "install", "--ignore-scripts"],
			dir,
		);
		run("npm", ["run", "build"], dir);
	}
}

function findBundles(dir) {
	const found = [];
	const walk = (d) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			const p = join(d, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (basename(d) === "dist" && /\.(m|c)?js$/.test(entry.name)) found.push(p);
		}
	};
	walk(dir);
	return found.sort();
}

function bundleFormat(file, code) {
	if (file.endsWith(".mjs") || /\.(module|esm)\.js$/.test(file)) return "esm";
	if (file.endsWith(".cjs")) return "cjs";
	if (/\.umd\.js$/.test(file) || /typeof define\s*==\s*["']function["']/.test(code)) return "umd";
	if (/^\s*(export|import)\s/m.test(code)) return "esm";
	return "cjs";
}

// Line-based count: blank lines and lines that are only comments are excluded.
function countLines(text) {
	let total = 0;
	let code = 0;
	let inBlock = false;
	for (const raw of text.split("\n")) {
		total++;
		let line = raw.trim();
		if (inBlock) {
			const end = line.indexOf("*/");
			if (end === -1) continue;
			inBlock = false;
			line = line.slice(end + 2).trim();
		}
		while (line.startsWith("/*")) {
			const end = line.indexOf("*/", 2);
			if (end === -1) {
				inBlock = true;
				line = "";
				break;
			}
			line = line.slice(end + 2).trim();
		}
		if (line && !line.startsWith("//")) code++;
	}
	return { total, code };
}

function isMinified(text) {
	const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("//# sourceMappingURL"));
	const chars = lines.reduce((acc, l) => acc + l.length, 0);
	return chars / lines.length > 100;
}

function sourceLines(file) {
	// Preact 10.x copies *.module.js to *.mjs without its sourcemap.
	const mapFile = [`${file}.map`, file.replace(/\.mjs$/, ".module.js.map")].find(existsSync);
	if (!mapFile) return null;
	const map = JSON.parse(readFileSync(mapFile, "utf8"));
	if (!map.sourcesContent) return null;
	let code = 0;
	let files = 0;
	map.sources.forEach((src, i) => {
		const content = map.sourcesContent[i];
		if (content == null || src.includes("node_modules")) return;
		files++;
		code += countLines(content).code;
	});
	return { files, code };
}

function stats(dir, file) {
	const buf = readFileSync(file);
	const text = buf.toString("utf8");
	const minified = isMinified(text);
	return {
		file: relative(dir, file),
		package: relative(dir, dirname(dirname(file))) || "preact",
		format: bundleFormat(file, text),
		minified,
		raw: statSync(file).size,
		gzip: gzipSync(buf, { level: 9 }).length,
		brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
		lines: minified ? null : countLines(text).code,
		source: sourceLines(file),
	};
}

function table(rows, headers, alignRight) {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
	const fmt = (r) =>
		r
			.map((c, i) => (alignRight[i] ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i])))
			.join("  ");
	return [fmt(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(fmt)].join("\n");
}

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

const tag = tagArg ?? latestStableTag();
const dir = mkdtempSync(join(tmpdir(), "preact-stats-"));
try {
	log(`Cloning preact ${tag} into ${dir}`);
	run("git", [
		"-c",
		"advice.detachedHead=false",
		"clone",
		"--quiet",
		"--depth",
		"1",
		"--branch",
		tag,
		REPO,
		dir,
	]);
	log("Installing and building (this takes a bit)...");
	build(dir);
	const results = findBundles(dir).map((f) => stats(dir, f));

	if (asJson) {
		console.log(JSON.stringify({ tag, bundles: results }, null, 2));
	} else {
		const rows = results.map((r) => [
			r.package,
			r.file,
			r.format + (r.minified ? " (min)" : ""),
			kb(r.raw),
			kb(r.gzip),
			kb(r.brotli),
			r.lines ?? "-",
			r.source ? `${r.source.code} (${r.source.files} files)` : "-",
		]);
		const sum = (k) => results.reduce((acc, r) => acc + r[k], 0);
		console.log(`\nPreact ${tag}\n`);
		console.log(
			table(
				rows,
				["package", "file", "format", "raw", "gzip", "brotli", "lines", "source lines"],
				[false, false, false, true, true, true, true, true],
			),
		);
		console.log(
			`\nTotal of ${results.length} bundles: ${kb(sum("raw"))} raw, ${kb(sum("gzip"))} gzip, ${kb(sum("brotli"))} brotli`,
		);
		console.log("lines: non-blank, non-comment lines of unminified bundles");
		console.log("source lines: same count over the sources in each bundle's sourcemap");
	}
} finally {
	if (keep) log(`Kept build at ${dir}`);
	else rmSync(dir, { recursive: true, force: true });
}
