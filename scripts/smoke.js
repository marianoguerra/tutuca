// Checks what gets published: every export imports by package name, the CDN bundles export
// the same names as the source, and the tarball holds only what it should.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

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

const names = (...mods) => [...new Set(mods.flatMap(Object.keys))].sort().join(",");
// The dev bundle is the core plus dev mode.
const core = await import(pkg.name);
const bundles = [
	{ mods: [core], files: ["dist/tutuca.js", "dist/tutuca.min.js"] },
	{
		mods: [core, await import(`${pkg.name}/dev`)],
		files: ["dist/tutuca.dev.js", "dist/tutuca.dev.min.js"],
	},
];
for (const { mods, files } of bundles) {
	const expected = names(...mods);
	for (const file of files) {
		if (names(await import(`../${file}`)) !== expected)
			problems.push(`${file}: exports differ from src`);
	}
}
// Every bundle is one file, and the core bundles leave dev mode's checks to tutuca.dev.js.
for (const file of readdirSync("dist")) {
	const text = readFileSync(`dist/${file}`, "utf8");
	if (/^\s*import\b|\bfrom\s*"\./m.test(text)) problems.push(`dist/${file}: imports other files`);
	if (!file.includes(".dev.") && /class DevChecks\b/.test(text))
		problems.push(`dist/${file}: carries DevChecks`);
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
