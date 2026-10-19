// Deterministic class diagram extractor: parses ES modules with acorn, follows relative imports
// from an entry file, and emits Mermaid + Graphviz from fixed, purely syntactic rules.
//
// Usage: node scripts/class-diagram.js <entry.js> <outDir>, e.g. src/tutuca.js for the core.
//
// Rules (no inference beyond these):
//   class        every ClassDeclaration / named ClassExpression bound with const in a reached module
//   module       the file the class is declared in (namespace / cluster)
//   attribute    class field definitions + every `this.<name> = …` in any method (first-seen order)
//   method       MethodDefinition; static → $, get/set prefixed, constructor omitted
//   visibility   #name or _name → private (-), otherwise public (+)
//   inheritance  `extends X` (X outside the graph is drawn as an external stub)
//   association  `this.<f> = new C(…)` where C is an in-graph class       → A --> C : f
//   dependency   any other reference to an in-graph class inside the body → A ..> C
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const [entryArg, outDir] = process.argv.slice(2);
const entry = resolve(entryArg);
const root = dirname(entry);

const modules = new Map(); // abs path → { ast, imports: Map<local, {from, imported}> }
const queue = [entry];
while (queue.length) {
	const file = queue.shift();
	if (modules.has(file)) continue;
	const src = readFileSync(file, "utf8");
	const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
	const imports = new Map();
	const deps = [];
	for (const node of ast.body) {
		const from = node.source?.value;
		if (!from?.startsWith(".")) continue;
		const target = resolve(dirname(file), from);
		// Only follow modules under the entry's directory (skips ../deps vendored code).
		if (!target.startsWith(root)) continue;
		deps.push(target);
		if (node.type === "ImportDeclaration")
			for (const s of node.specifiers)
				imports.set(s.local.name, { from: target, imported: s.imported?.name ?? "default" });
	}
	modules.set(file, { ast, imports });
	queue.push(...deps.sort());
}

const modName = (file) => relative(root, file).replace(/\.js$/, "");

// Collect classes.
const classes = new Map(); // "mod:Name" → info
const classNode = (node) => {
	if (node.type === "ClassDeclaration") return [node.id.name, node];
	if (node.type === "VariableDeclaration")
		for (const d of node.declarations)
			if (d.init?.type === "ClassExpression") return [d.id.name, d.init];
	return null;
};
for (const [file, { ast }] of modules) {
	for (let node of ast.body) {
		if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration")
			node = node.declaration;
		const found = node && classNode(node);
		if (!found) continue;
		const [name, cls] = found;
		classes.set(`${modName(file)}:${name}`, { name, file, mod: modName(file), cls });
	}
}

// Resolve an identifier used in `file` to a class key, following imports and re-exports.
const exportsOf = (file) => {
	const out = new Map();
	for (const node of modules.get(file).ast.body) {
		if (node.type !== "ExportNamedDeclaration" || !node.source) continue;
		const target = resolve(dirname(file), node.source.value);
		for (const s of node.specifiers)
			out.set(s.exported.name, { from: target, imported: s.local.name });
	}
	return out;
};
const resolveName = (file, name, seen = new Set()) => {
	const key = `${modName(file)}:${name}`;
	if (classes.has(key)) return key;
	if (seen.has(key) || !modules.has(file)) return null;
	seen.add(key);
	const imp = modules.get(file).imports.get(name) ?? exportsOf(file).get(name);
	return imp && modules.has(imp.from) ? resolveName(imp.from, imp.imported, seen) : null;
};

const paramName = (p) =>
	p.type === "Identifier"
		? p.name
		: p.type === "AssignmentPattern"
			? `${paramName(p.left)}?`
			: p.type === "RestElement"
				? `...${paramName(p.argument)}`
				: p.type === "ObjectPattern"
					? "{…}"
					: "[…]";
const vis = (n) => (n.startsWith("#") || n.startsWith("_") ? "-" : "+");
const keyName = (k) =>
	k.type === "PrivateIdentifier" ? `#${k.name}` : (k.name ?? String(k.value));

for (const info of classes.values()) {
	const { cls, file } = info;
	info.parent = null;
	if (cls.superClass?.type === "Identifier")
		info.parent = resolveName(file, cls.superClass.name) ?? `external:${cls.superClass.name}`;
	info.attrs = [];
	info.methods = [];
	info.assoc = new Map(); // target → Set(field)
	info.deps = new Set();
	const addAttr = (name, isStatic) => {
		if (!info.attrs.some((a) => a.name === name)) info.attrs.push({ name, isStatic });
	};
	for (const m of cls.body.body) {
		if (m.type === "PropertyDefinition") addAttr(keyName(m.key), m.static);
		if (m.type === "MethodDefinition" && m.kind !== "constructor") {
			const params = m.value.params.map(paramName);
			info.methods.push({ name: keyName(m.key), kind: m.kind, isStatic: m.static, params });
		}
	}
	const own = new Set([`${info.mod}:${info.name}`]);
	walk.full(cls.body, (n) => {
		if (
			n.type === "AssignmentExpression" &&
			n.left.type === "MemberExpression" &&
			n.left.object.type === "ThisExpression" &&
			!n.left.computed
		) {
			const field = keyName(n.left.property);
			addAttr(field, false);
			if (n.right.type === "NewExpression" && n.right.callee.type === "Identifier") {
				const target = resolveName(file, n.right.callee.name);
				if (target) {
					if (!info.assoc.has(target)) info.assoc.set(target, new Set());
					info.assoc.get(target).add(field);
				}
			}
		}
		if (n.type === "Identifier") {
			const target = resolveName(file, n.name);
			if (target && !own.has(target)) info.deps.add(target);
		}
	});
	for (const t of info.assoc.keys()) info.deps.delete(t);
	if (info.parent) info.deps.delete(info.parent);
}

// ---- emit ----
const sorted = [...classes.entries()].sort(([a], [b]) => a.localeCompare(b));
const byMod = new Map();
for (const [key, info] of sorted) {
	if (!byMod.has(info.mod)) byMod.set(info.mod, []);
	byMod.get(info.mod).push([key, info]);
}
const id = (key) => key.replace(/[^A-Za-z0-9]/g, "_");
const label = (key) => key.split(":")[1];
const externals = [
	...new Set(sorted.map(([, i]) => i.parent).filter((p) => p?.startsWith("external:"))),
].sort();
const methodText = (m) =>
	`${vis(m.name)}${m.kind === "get" ? "get " : m.kind === "set" ? "set " : ""}${m.name}(${m.kind === "method" ? m.params.join(", ") : ""})`;

const edges = [];
for (const [key, info] of sorted) {
	if (info.parent) edges.push({ kind: "extends", from: key, to: info.parent });
	for (const [t, fields] of [...info.assoc].sort(([a], [b]) => a.localeCompare(b)))
		edges.push({ kind: "assoc", from: key, to: t, label: [...fields].sort().join(", ") });
	for (const t of [...info.deps].sort()) edges.push({ kind: "dep", from: key, to: t });
}

// Mermaid
const mm = ["classDiagram", "  direction LR"];
for (const [mod, list] of byMod) {
	mm.push(`  namespace ${id(mod)} {`);
	for (const [key, info] of list) {
		mm.push(`    class ${id(key)}["${info.name}"] {`);
		for (const a of info.attrs) mm.push(`      ${vis(a.name)}${a.name}${a.isStatic ? "$" : ""}`);
		for (const m of info.methods) mm.push(`      ${methodText(m)}${m.isStatic ? "$" : ""}`);
		mm.push("    }");
	}
	mm.push("  }");
}
for (const e of externals) mm.push(`  class ${id(e)}["${label(e)}"]`, `  <<external>> ${id(e)}`);
for (const e of edges) {
	const arrow = { extends: "--|>", assoc: "-->", dep: "..>" }[e.kind];
	mm.push(`  ${id(e.from)} ${arrow} ${id(e.to)}${e.label ? ` : ${e.label}` : ""}`);
}

// Graphviz
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dot = [
	"digraph tutuca_core {",
	'  graph [rankdir=BT, fontname="Helvetica", fontsize=11, newrank=true, nodesep=0.3, ranksep=0.6];',
	'  node [shape=plain, fontname="Helvetica", fontsize=10];',
	'  edge [fontname="Helvetica", fontsize=9];',
];
const rows = (items) =>
	items.length
		? items.map((s) => `<tr><td align="left">${esc(s)}</td></tr>`).join("")
		: "<tr><td> </td></tr>";
for (const [mod, list] of byMod) {
	dot.push(
		`  subgraph cluster_${id(mod)} {`,
		`    label="${mod}.js"; style="rounded,dashed"; color="#888888";`,
	);
	for (const [key, info] of list) {
		const attrs = info.attrs.map((a) => `${vis(a.name)} ${a.name}${a.isStatic ? " (static)" : ""}`);
		const meths = info.methods.map((m) => `${methodText(m)}${m.isStatic ? " (static)" : ""}`);
		dot.push(
			`    ${id(key)} [label=<<table border="1" cellborder="0" cellspacing="0" cellpadding="3">` +
				`<tr><td bgcolor="#e8eef7"><b>${esc(info.name)}</b></td></tr>` +
				`<tr><td><table border="0" cellborder="0" cellspacing="0" cellpadding="1">${rows(attrs)}</table></td></tr>` +
				`<tr><td sides="t" border="1"><table border="0" cellborder="0" cellspacing="0" cellpadding="1">${rows(meths)}</table></td></tr>` +
				"</table>>];",
		);
	}
	dot.push("  }");
}
for (const e of externals)
	dot.push(`  ${id(e)} [shape=box, style=dashed, label="«external»\\n${label(e)}"];`);
for (const e of edges) {
	const style = {
		extends: "arrowhead=empty",
		assoc: `arrowhead=vee, label="${e.label}"`,
		dep: 'arrowhead=vee, style=dashed, color="#999999"',
	}[e.kind];
	dot.push(`  ${id(e.from)} -> ${id(e.to)} [${style}];`);
}
dot.push("}");

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/tutuca-core.mmd`, `${mm.join("\n")}\n`);
writeFileSync(`${outDir}/tutuca-core.dot`, `${dot.join("\n")}\n`);
writeFileSync(
	`${outDir}/tutuca-core.json`,
	`${JSON.stringify(
		{
			modules: [...modules.keys()].map(modName).sort(),
			classes: sorted.map(([key, i]) => ({
				key,
				module: i.mod,
				name: i.name,
				parent: i.parent,
				attributes: i.attrs,
				methods: i.methods,
			})),
			edges,
		},
		null,
		1,
	)}\n`,
);
console.log(`${modules.size} modules, ${classes.size} classes, ${edges.length} edges`);
