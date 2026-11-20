// Writes spec/features.md from tables.js: every feature, its status and why, so the spec's
// list of what is in, omitted and excluded is the one the sieve uses. node tools/spec-tables.js
// (the tests check the file is current).

import { writeFileSync } from "node:fs";
import { FEATURES, METHODS, RESERVED_NAMES } from "../lib/index.js";

export const featuresMarkdown = () => {
	const rows = (status) =>
		Object.entries(FEATURES)
			.filter(([, f]) => f.status === status)
			.map(
				([name, f]) =>
					`| \`${name}\` | ${f.what} | ${status === "by-design" ? f.why : (f.profile ?? "")} |`,
			);
	const methods = Object.entries(METHODS).flatMap(([kind, ms]) =>
		Object.entries(ms).map(
			([name, m]) =>
				`| ${kind} | \`${name}\` | \`${m.sig}\` | ${[m.mutates && "changes its receiver", m.fresh && "returns a fresh list", m.self && "returns its receiver", m.primitive && "elements must be primitive"].filter(Boolean).join("; ")} |`,
		),
	);
	return [
		"# Features",
		"",
		"Generated from `lib/tables.js` by `node tools/spec-tables.js`: what the sieve admits, leaves for",
		"a later version, and excludes by design. A diagnostic's code is the feature's name.",
		"",
		"## In the core profile",
		"",
		"| Feature | What | |",
		"|---|---|---|",
		...rows("core"),
		"",
		"## Omitted from this version",
		"",
		"Exit status 2. The last column names the profile that will admit it, when one is planned.",
		"",
		"| Feature | What | Profile |",
		"|---|---|---|",
		...rows("omitted"),
		"",
		"## Excluded by design",
		"",
		"Exit status 1. No profile admits these.",
		"",
		"| Feature | What | Why |",
		"|---|---|---|",
		...rows("by-design"),
		"",
		"## Reserved names",
		"",
		"No property, key or host member may have these names:",
		"",
		RESERVED_NAMES.map((n) => `\`${n}\``).join(", "),
		"",
		"`call`, `apply` and `bind` only name members of host modules.",
		"",
		"## Built-in methods",
		"",
		"`T` is the type of a list's elements.",
		"",
		"| Receiver | Method | Signature | |",
		"|---|---|---|---|",
		...methods,
		"",
	].join("\n");
};

if (import.meta.url === `file://${process.argv[1]}`) {
	writeFileSync(new URL("../spec/features.md", import.meta.url), featuresMarkdown());
	console.log("wrote spec/features.md");
}
