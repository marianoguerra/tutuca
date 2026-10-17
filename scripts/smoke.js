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
const core = names(await import(pkg.name));
for (const file of ["dist/tutuca.js", "dist/tutuca.min.js"]) {
	if (names(await import(`../${file}`)) !== core) problems.push(`${file}: exports differ from src`);
}

const [packed] = JSON.parse(
	execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
);
const allowed = /^(src\/|deps\/|dist\/|README\.md$|LICENSE$|package\.json$)/;
for (const { path } of packed.files) {
	if (!allowed.test(path)) problems.push(`unexpected file in the package: ${path}`);
}

if (problems.length > 0) {
	console.error(problems.join("\n"));
	process.exit(1);
}
console.log(`ok: ${packed.files.length} files, ${(packed.size / 1024).toFixed(1)} KB packed`);
