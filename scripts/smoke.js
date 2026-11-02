// Checks what gets published: every export imports by package name, the CDN bundles export
// the same names as the source, and the tarball holds only what it should.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const problems = [];

for (const sub of Object.keys(pkg.exports)) {
	if (sub.endsWith(".json")) continue;
	const name = pkg.name + sub.slice(1);
	try {
		await import(name);
	} catch (err) {
		problems.push(`import ${name}: ${err.message}`);
	}
}

const names = (mod) => Object.keys(mod).sort().join(",");
const bundles = [
	{ src: pkg.name, files: ["dist/tutuca.js", "dist/tutuca.min.js"] },
	{ src: `${pkg.name}/dev`, files: ["dist/tutuca.dev.js", "dist/tutuca.dev.min.js"] },
];
for (const { src, files } of bundles) {
	const expected = names(await import(src));
	for (const file of files) {
		if (names(await import(`../${file}`)) !== expected)
			problems.push(`${file}: exports differ from src`);
	}
}
// The core bundles and what they import leave dev mode's checks to tutuca.dev.js.
const importsOf = (file, seen = new Set()) => {
	if (seen.has(file)) return seen;
	seen.add(file);
	const text = readFileSync(file, "utf8");
	for (const [, rel] of text.matchAll(/from\s*"(\.[^"]+)"/g))
		importsOf(
			new URL(rel, `file://${process.cwd()}/${file}`).pathname.slice(process.cwd().length + 1),
			seen,
		);
	return seen;
};
for (const entry of ["dist/tutuca.js", "dist/tutuca.min.js"]) {
	for (const file of importsOf(entry)) {
		if (/class DevChecks\b/.test(readFileSync(file, "utf8")))
			problems.push(`${entry}: carries DevChecks (through ${file})`);
	}
}

const [packed] = JSON.parse(
	execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
);
// What package.json "files" lists, folders ending in /, and package.json itself.
const allowed = (path) =>
	path === "package.json" ||
	pkg.files.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
for (const { path } of packed.files) {
	if (!allowed(path)) problems.push(`unexpected file in the package: ${path}`);
}

if (problems.length > 0) {
	console.error(problems.join("\n"));
	process.exit(1);
}
console.log(`ok: ${packed.files.length} files, ${(packed.size / 1024).toFixed(1)} KB packed`);
