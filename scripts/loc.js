// Lines of code per submodule of src/: the files directly in it are the core, each folder is
// its own submodule. Prints an ASCII table, largest first.
import { globSync, readFileSync } from "node:fs";

const rows = new Map(); // submodule → { files, lines, code }
for (const file of globSync("src/**/*.js")) {
	const parts = file.split("/");
	const name = parts.length === 2 ? "core" : parts[1];
	const text = readFileSync(file, "utf8");
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	const code = lines.filter((l) => l.trim() !== "" && !l.trim().startsWith("//")).length;
	const row = rows.get(name) ?? { files: 0, lines: 0, code: 0 };
	row.files += 1;
	row.lines += lines.length;
	row.code += code;
	rows.set(name, row);
}

const sorted = [...rows].sort(([, a], [, b]) => b.lines - a.lines);
const sum = (key) => sorted.reduce((n, [, r]) => n + r[key], 0);
const table = [
	["submodule", "files", "lines", "code"],
	...sorted.map(([name, r]) => [name, r.files, r.lines, r.code]),
	["total", sum("files"), sum("lines"), sum("code")],
].map((row) => row.map(String));
const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
const cells = (row) =>
	`| ${row.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(" | ")} |`;
const rule = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;

console.log(rule);
console.log(cells(table[0]));
console.log(rule);
for (const row of table.slice(1, -1)) console.log(cells(row));
console.log(rule);
console.log(cells(table.at(-1)));
console.log(rule);
