// Formats the Wax sources in place with wax-mb's formatter, or with --check
// lists the ones that would change and fails.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS, SOURCES, findWaxMb } from "./build.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// wax-mb's formatter moves a comment or blank line above an attributed
// declaration inside an import block into the attribute
// (wax-mb-usage-feedback.md), which is all of imports.wax: it stays as written.
const UNFORMATTED = new Set(["src/imports.wax"]);
// Only our sources: the vendored files stay as upstream ships them, and the
// generated ones in dist/ aren't kept.
const OURS = ["src/", "prelude/", "lib/", "components/"];
const formatted = (f) => OURS.some((dir) => f.startsWith(dir)) && !UNFORMATTED.has(f);
const files = [...new Set([...SOURCES, ...COMPONENTS.flatMap((c) => c.sources)])].filter(formatted);
const check = process.argv.includes("--check");
const result = spawnSync(findWaxMb(), ["format", check ? "--check" : "-i", ...files], {
	cwd: root,
	stdio: "inherit",
});
if (result.error) {
	console.error(`could not run wax-mb (${result.error.message}); run \`npm run setup\` or set WAX_MB`);
	process.exit(1);
}
if (result.status !== 0 && check) console.error("these files need `npm run format`");
process.exit(result.status ?? 1);
